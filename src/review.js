import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  dataDir,
  ensureAppDirs,
  getAccountConfigDir,
  getAccountLogPath,
  getAccountResumePath,
  getAccountSalaryPath,
  getAccountStorageStatePath,
  inputDir,
  logsDir,
  normalizeAccountName,
  rootDir
} from './config.js';
import { dismissHarmlessPopups, launchBrowser } from './browser.js';
import { ask } from './prompts.js';
import { cleanGeneratedAnswer, parseJsonObject } from './lib/text.js';
import { extractRequirements } from './lib/vacancyExtract.js';
import { detectFieldKind, getMainQuestion, isGenericFieldContext, isSalaryContext } from './lib/fields.js';
import { RESUME_KEYWORDS, extractResumeKeywords, getSearchTerms, pickKnowledgeChunks } from './lib/knowledge.js';
import { normalizeHhUrl, normalizeVacancyUrl } from './lib/urls.js';
import { looksLikeEmployerVoice, matchesAnyPattern, optionMatches } from './lib/answers.js';
import { callDeepSeek, redactSecrets } from './lib/deepseek.js';
import { runUsageCounter } from './lib/usageCounter.js';
import { localRelevanceScore, needsModelScoring } from './lib/localScore.js';
import { cacheKey, getCached, hashResume, loadCache, saveCache, setCached } from './lib/scoreCache.js';
import { coverLetterRequired } from './lib/coverLetter.js';
import { isAlreadyApplied } from './lib/applied.js';
import { isSubmitAllowed } from './lib/applyGuard.js';
import { REQUIRED_MANUAL_PATTERNS, RESPONSE_BUTTON_TEXTS, APPLICATION_FLOW_BUTTON_TEXTS } from './lib/selectors.js';


const DEFAULT_LIMIT = 200;
const DEFAULT_AREA = '1';
const DEFAULT_DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
const DEFAULT_RELEVANCE_MIN_SCORE = 65;
const DEFAULT_RESUME_SKILLS_LIMIT = 30;
const envPath = path.join(rootDir, '.env');
const deepSeekDebugPath = path.join(logsDir, 'deepseek-debug.jsonl');
const scoreCachePath = path.join(dataDir, 'score-cache.json');

function parseArgs(argv) {
  const args = {
    file: path.join(inputDir, 'vacancies.txt'),
    search: '',
    text: '',
    area: DEFAULT_AREA,
    limit: DEFAULT_LIMIT,
    minScore: DEFAULT_RELEVANCE_MIN_SCORE,
    resumeSkillsLimit: DEFAULT_RESUME_SKILLS_LIMIT,
    accounts: ['default'],
    autoApply: true,
    dryRun: false,
    ai: true,
    debugAi: false,
    upgradeResume: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--file') args.file = path.resolve(argv[++index]);
    else if (arg === '--search') args.search = argv[++index] || '';
    else if (arg === '--text') args.text = argv[++index] || '';
    else if (arg === '--area') args.area = argv[++index] || DEFAULT_AREA;
    else if (arg === '--limit') args.limit = Number(argv[++index] || args.limit);
    else if (arg === '--min-score') args.minScore = Number(argv[++index] || args.minScore);
    else if (arg === '--resume-skills-limit') args.resumeSkillsLimit = Number(argv[++index] || args.resumeSkillsLimit);
    else if (arg === '--account') args.accounts = [normalizeAccountName(argv[++index] || 'default')];
    else if (arg === '--accounts') {
      args.accounts = (argv[++index] || 'default')
        .split(',')
        .map((account) => normalizeAccountName(account))
        .filter(Boolean);
    }
    else if (arg === '--yes' || arg === '--auto-apply' || arg === '-y') args.autoApply = true;
    else if (arg === '--manual') args.autoApply = false;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--ai') args.ai = true;
    else if (arg === '--debug-ai') args.debugAi = true;
    else if (arg === '--upgrade-resume') args.upgradeResume = true;
  }

  if (!Number.isFinite(args.limit) || args.limit < 1) {
    throw new Error('Параметр --limit должен быть положительным числом.');
  }

  if (!Number.isFinite(args.minScore) || args.minScore < 0 || args.minScore > 100) {
    throw new Error('Параметр --min-score должен быть числом от 0 до 100.');
  }

  if (!Number.isFinite(args.resumeSkillsLimit) || args.resumeSkillsLimit < 1 || args.resumeSkillsLimit > 30) {
    throw new Error('Параметр --resume-skills-limit должен быть числом от 1 до 30.');
  }

  if (args.accounts.length === 0) {
    args.accounts = ['default'];
  }
  args.accounts = [...new Set(args.accounts)];

  if (!args.search && args.text) {
    const searchUrl = new URL('https://hh.ru/search/vacancy');
    searchUrl.searchParams.set('text', args.text);
    searchUrl.searchParams.set('area', args.area);
    args.search = searchUrl.toString();
  }

  return args;
}

async function readVacancyFile(filePath) {
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map(normalizeHhUrl);
}

async function readOptionalText(filePath) {
  if (!existsSync(filePath)) return '';
  return (await readFile(filePath, 'utf8')).trim();
}

function stripTemplateText(text, markers) {
  return markers.some((marker) => text.includes(marker)) ? '' : text;
}

const RESUME_TEMPLATE = `# Резюме

Заполните резюме для этого аккаунта:

- целевая должность;
- общий опыт;
- ключевые технологии;
- последние проекты;
- сильные стороны;
- формат работы;
- город/часовой пояс;
- ограничения, о которых важно честно говорить.
`;

const SALARY_TEMPLATE = `# Зарплатные ожидания

Замените этот текст на реальные зарплатные ожидания для этого аккаунта.

Укажите:

- ожидаемую сумму или вилку;
- gross/net, если важно;
- минимальную сумму, ниже которой не опускаться;
- как отвечать, если работодатель просит "уровень заработной платы";
- готовы ли обсуждать вилку в зависимости от задач и формата.
`;

async function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;

  const raw = await readFile(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    value = value.replace(/^["']|["']$/g, '');

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function loadKnowledgeBase(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile() && /\.(md|txt)$/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name));

  const chunks = [];

  for (const file of files) {
    const raw = await readOptionalText(file);
    if (!raw) continue;

    const parts = raw
      .split(/\n(?=#{1,6}\s)|\n{3,}/)
      .map((part) => part.trim())
      .filter(Boolean);

    for (const part of parts) {
      const normalized = part.replace(/\s+/g, ' ').trim();
      if (normalized.length < 80) continue;

      chunks.push({
        file: path.basename(file),
        text: normalized.slice(0, 1000)
      });
    }
  }

  return chunks;
}

async function collectFromSearch(page, searchUrl, limit) {
  const urls = new Set();
  const baseUrl = new URL(searchUrl);
  baseUrl.searchParams.set('per_page', '100');
  let pageIndex = Number(baseUrl.searchParams.get('page') || 0);
  let pagesWithoutNewVacancies = 0;

  while (urls.size < limit && pagesWithoutNewVacancies < 2) {
    const nextUrl = new URL(baseUrl);
    nextUrl.searchParams.set('page', String(pageIndex));
    const beforePage = urls.size;

    await page.goto(nextUrl.toString(), { waitUntil: 'domcontentloaded' });
    await dismissHarmlessPopups(page);
    await page.waitForTimeout(900);

    const pageUrls = await page.$$eval('a[href*="/vacancy/"]', (links) =>
      links.map((link) => link.href).filter((href) => /\/vacancy\/\d+/.test(new URL(href).pathname))
    );

    for (const url of pageUrls) {
      if (urls.size >= limit) break;
      const vacancyUrl = normalizeVacancyUrl(url);
      if (vacancyUrl) urls.add(vacancyUrl);
    }

    const added = urls.size - beforePage;
    console.log(`Собрал вакансий из поиска: ${urls.size}/${limit} (страница ${pageIndex + 1}, новых ${added}).`);

    pagesWithoutNewVacancies = added === 0 ? pagesWithoutNewVacancies + 1 : 0;
    pageIndex += 1;
  }

  return [...urls];
}

async function findResponseButton(page) {
  for (const text of RESPONSE_BUTTON_TEXTS) {
    const button = page.getByRole('button', { name: text }).first();
    if (await button.isVisible().catch(() => false)) return button;

    const link = page.getByRole('link', { name: text }).first();
    if (await link.isVisible().catch(() => false)) return link;
  }

  return null;
}

async function getVisibleText(page) {
  return page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
}

async function getVacancyText(page) {
  const text = await getVisibleText(page);
  return text
    .replace(/\s+/g, ' ')
    .replace(/Откликнуться на вакансию/gi, '')
    .trim()
    .slice(0, 9000);
}

function countMapValue(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function getTopMapEntries(map, limit = 20) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ru'))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function createResumeUpgradeCollector(account) {
  return {
    account,
    vacanciesSeen: 0,
    relevantVacancies: 0,
    keywordCounts: new Map(),
    greenSignalCounts: new Map(),
    titleCounts: new Map(),
    examples: []
  };
}

async function extractHhMatchSignals(page) {
  return page.evaluate(() => {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const isVisible = (node) => {
      if (!node || !(node instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && node.offsetParent !== null;
    };
    const parseRgb = (value) => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (!match) return null;
      return {
        r: Number(match[1]),
        g: Number(match[2]),
        b: Number(match[3])
      };
    };
    const isGreenish = (value) => {
      const rgb = parseRgb(value);
      if (!rgb) return false;
      return rgb.g > rgb.r + 20 && rgb.g > rgb.b + 10 && rgb.g > 90;
    };
    const result = [];

    for (const element of document.querySelectorAll('body *')) {
      if (!isVisible(element)) continue;
      const text = clean(element.textContent);
      if (text.length < 5 || text.length > 280) continue;

      const style = window.getComputedStyle(element);
      const green = isGreenish(style.backgroundColor) || isGreenish(style.color) || isGreenish(style.borderColor);
      const looksLikeMatch = /совпад|подход|резюме|навык|скилл|умени|ключев/i.test(text);

      if (green && looksLikeMatch && !result.includes(text)) {
        result.push(text);
      }
    }

    return result.slice(0, 10);
  }).catch(() => []);
}

async function collectResumeUpgradeSignals(page, collector, vacancy, relevance) {
  if (!collector) return;

  const keywords = extractResumeKeywords(`${vacancy.title}\n${vacancy.text}`);
  const hhMatches = await extractHhMatchSignals(page);

  collector.vacanciesSeen += 1;
  if (Number(relevance?.score || 0) >= 65) {
    collector.relevantVacancies += 1;
  }

  countMapValue(collector.titleCounts, vacancy.title);

  for (const keyword of keywords) {
    countMapValue(collector.keywordCounts, keyword);
  }

  for (const signal of hhMatches) {
    countMapValue(collector.greenSignalCounts, signal);
  }

  if (collector.examples.length < 12) {
    collector.examples.push({
      title: vacancy.title,
      url: vacancy.url,
      relevanceScore: relevance?.score,
      relevanceReason: relevance?.reason,
      keywords: keywords.slice(0, 12),
      hhMatches
    });
  }
}

async function appendDeepSeekDebug(entry, enabled) {
  if (!enabled) return;
  await appendFile(deepSeekDebugPath, `${JSON.stringify({ ...redactSecrets(entry), at: new Date().toISOString() })}\n`).catch(() => {});
}

function renderResumeUpgradeFallback({ account, summary }) {
  const skills = summary.topKeywords.map((item) => `- ${item.name} (${item.count})`).join('\n') || '- Недостаточно данных.';
  const matches = summary.greenSignals.map((item) => `- ${item.name} (${item.count})`).join('\n') || '- Не найдено.';

  return [
    `# Resume Upgrade Report: ${account}`,
    '',
    `Просмотрено вакансий: ${summary.vacanciesSeen}`,
    `Релевантных вакансий: ${summary.relevantVacancies}`,
    '',
    '## До 30 ключевых навыков-кандидатов',
    '',
    skills,
    '',
    '## Зеленые hh-сигналы совпадения',
    '',
    matches,
    '',
    '## Что сделать вручную',
    '',
    '- Добавить только те навыки, по которым есть реальный опыт.',
    '- Не расширять обязанности большими абзацами; лучше добавить 2-4 точные формулировки в опыт.',
    '- Проверить, чтобы суммарно в блоке навыков было не больше 30 пунктов.'
  ].join('\n');
}

async function buildResumeUpgradeReport({ account, collector, deepSeekContext, skillsLimit }) {
  const summary = {
    vacanciesSeen: collector.vacanciesSeen,
    relevantVacancies: collector.relevantVacancies,
    topKeywords: getTopMapEntries(collector.keywordCounts, skillsLimit),
    greenSignals: getTopMapEntries(collector.greenSignalCounts, 20),
    commonTitles: getTopMapEntries(collector.titleCounts, 10),
    examples: collector.examples
  };

  const system = [
    'Ты помогаешь улучшить резюме кандидата после анализа вакансий hh.ru.',
    'Отвечай markdown без JSON.',
    'Нужно предложить только точечные добавления в резюме, без переписывания всего резюме.',
    `В блок ключевых навыков можно рекомендовать максимум ${skillsLimit} навыков.`,
    'Не расплывайся в обязанностях: максимум 3-5 коротких bullets для опыта.',
    'Не советуй добавлять навык, если он явно не встречался часто или нет основания из резюме/вакансий.',
    'Отдельно отметь навыки, которые нельзя добавлять без реального опыта.',
    'Опирайся на частотность ключевых слов, зеленые hh-сигналы совпадения и текущий resume.md.'
  ].join(' ');

  const user = [
    `Аккаунт: ${account}`,
    '',
    'Текущее резюме:',
    deepSeekContext.resume || 'Резюме не заполнено.',
    '',
    'Статистика прогона:',
    JSON.stringify(summary, null, 2),
    '',
    'Сформируй отчет с разделами:',
    '1. Короткий вывод.',
    `2. Ключевые навыки: список до ${skillsLimit} пунктов, отсортированный по полезности.`,
    '3. Что добавить в опыт: 3-5 коротких bullets без раздутых обязанностей.',
    '4. Что НЕ добавлять без реального опыта.',
    '5. Какие вопросы проверить вручную перед правкой резюме.'
  ].join('\n');

  await appendDeepSeekDebug({
    phase: 'resume-upgrade-request',
    account,
    topKeywords: summary.topKeywords,
    greenSignals: summary.greenSignals,
    userPromptPreview: user.slice(0, 4000)
  }, deepSeekContext.debugAi);

  const result = await callDeepSeek({
    apiKey: deepSeekContext.apiKey,
    apiUrl: deepSeekContext.apiUrl,
    model: deepSeekContext.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.1,
    maxTokens: 1200
  });

  if (!result.ok || !result.content.trim()) {
    return renderResumeUpgradeFallback({ account, summary });
  }

  await appendDeepSeekDebug({
    phase: 'resume-upgrade-response',
    account,
    rawAnswer: result.content
  }, deepSeekContext.debugAi);

  return result.content.trim();
}

async function finishResumeUpgradeReport({ account, collector, deepSeekContext, skillsLimit }) {
  if (!collector || collector.vacanciesSeen === 0) return;

  const report = await buildResumeUpgradeReport({
    account,
    collector,
    deepSeekContext,
    skillsLimit
  });
  const reportPath = path.join(logsDir, `resume-upgrade-${account}.md`);

  await writeFile(reportPath, `${report}\n`, 'utf8');

  console.log(`\n=== Resume upgrade report: ${account} ===`);
  console.log(report);
  console.log(`\nОтчет сохранен: ${reportPath}`);
}

async function scoreVacancyWithDeepSeek({ title, url, vacancyText, resume, apiKey, apiUrl, model, debugAi }) {
  const system = [
    'Ты оцениваешь релевантность вакансии кандидату.',
    'Отвечай только JSON без markdown.',
    'Формат: {"score":75,"reason":"короткая причина"}.',
    'score от 0 до 100. Высокий score означает, что стоит тратить токены и откликаться.'
  ].join(' ');
  const user = [
    `Вакансия: ${title}`,
    `URL: ${url}`,
    '',
    'Текст вакансии:',
    extractRequirements(vacancyText),
    '',
    'Резюме кандидата:',
    resume || 'Резюме не заполнено.'
  ].join('\n');

  await appendDeepSeekDebug({
    phase: 'relevance-request',
    title,
    url,
    model,
    userPromptPreview: user.slice(0, 2500)
  }, debugAi);

  const result = await callDeepSeek({
    apiKey,
    apiUrl,
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0,
    maxTokens: 120
  });

  if (!result.ok) {
    await appendDeepSeekDebug({ phase: 'relevance-error', status: result.status, body: result.body?.slice(0, 1000) }, debugAi);
    return {
      score: 0,
      reason: result.status === 402 ? 'deepseek_insufficient_balance' : 'relevance_check_failed',
      aiFailed: true,
      aiStatus: result.status
    };
  }

  let parsed = { score: 0, reason: 'parse_failed' };
  try {
    parsed = parseJsonObject(result.content);
  } catch {}

  const score = Number(parsed.score);
  const normalized = {
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
    reason: String(parsed.reason || '').slice(0, 300)
  };

  await appendDeepSeekDebug({
    phase: 'relevance-response',
    title,
    url,
    rawAnswer: result.content,
    ...normalized
  }, debugAi);

  return normalized;
}

async function askDeepSeek({
  kind,
  context,
  title,
  url,
  vacancyText,
  resume,
  salary,
  salaryPath,
  knowledgeBase,
  apiKey,
  apiUrl,
  model,
  debugAi
}) {
  if (!apiKey) return '';

  if (kind === 'salary' && !salary.trim()) {
    console.log(`Не заполнен ${salaryPath || 'salary.md'}: не могу ответить на вопрос о зарплате.`);
    return '';
  }

  // coverLetter и salary не получают RAG: coverLetter экономит токены, salary берётся только из salary.md.
  const knowledgeChunks = (kind === 'coverLetter' || kind === 'salary')
    ? []
    : pickKnowledgeChunks(`${title}\n${context}\n${vacancyText || ''}`, knowledgeBase);
  const knowledgeText = knowledgeChunks.length
    ? knowledgeChunks.map((chunk, index) => `[${index + 1}] ${chunk.file}\n${chunk.text}`).join('\n\n')
    : 'Нет релевантных фрагментов базы знаний.';
  const salaryText = kind === 'salary'
    ? (salary || 'Зарплатные ожидания не заполнены.')
    : 'Не использовать зарплатные ожидания: этот вопрос не про зарплату.';

  const system = [
    'Ты помогаешь кандидату заполнять отклики на вакансии.',
    'Ответ должен быть ровно текстом для одного поля формы.',
    'Никогда не начинай с приветствия, знакомства, "Здравствуйте", "Привет", "Рад познакомиться" или вводных фраз.',
    'Не используй плейсхолдеры вроде [Имя], [Фамилия], [Телефон], [Компания].',
    'Если имя кандидата не указано в резюме, не пиши имя и не используй фразу "Меня зовут".',
    'Отвечай только на основе данных, которые переданы в запросе.',
    'Используй зарплатные ожидания только если тип поля "зарплата". В остальных ответах не упоминай зарплату.',
    'Не выдумывай места работы, опыт, проекты, зарплатные ожидания и личные факты.',
    'Для сопроводительного письма позиционируй кандидата максимально релевантно вакансии: цель — получить приглашение на собеседование.',
    'Сопроводительное письмо всегда пишется от лица кандидата, а не работодателя или рекрутера.',
    'Не пиши фразы от лица собеседующего: "ваш опыт релевантен", "готов пригласить", "мы пригласим", "рассмотрим вашу кандидатуру", "подходите нашей компании".',
    'В сопроводительном письме избегай местоимения "я" и формулировок "я готов", "я занимался", если можно написать нейтральнее: "есть опыт", "готовность", "практический опыт", "интересны задачи".',
    'Не подчеркивай недостающие технологии и не извиняйся за пробелы. Если технологии нет в данных кандидата, говори через близкий опыт, инженерный контекст и готовность быстро включиться, без ложного утверждения владения.',
    'Если честный ответ невозможно составить из переданных данных, верни ровно NO_ANSWER.',
    'Пиши по-русски, кратко, естественно, без markdown.',
    'Для вопроса о зарплате верни только сумму или вилку из зарплатных ожиданий, без пояснений.'
  ].join(' ');

  const task =
    kind === 'salary'
      ? 'Ответь на вопрос о зарплате. Верни только сумму или вилку из зарплатных ожиданий.'
      : kind === 'coverLetter'
        ? 'Составь короткое сопроводительное письмо на 1-2 предложения, без приветствия, без имени и без плейсхолдеров. Пиши от лица кандидата, не от лица работодателя. Не используй фразы "ваш опыт релевантен", "готов пригласить", "мы". Желательно без местоимения "я".'
        : 'Составь короткий честный ответ на вопрос работодателя, без приветствия.';

  const user = [
    `Тип поля: ${kind === 'salary' ? 'зарплата' : kind === 'coverLetter' ? 'сопроводительное письмо' : 'вопрос работодателя'}`,
    `Вакансия: ${title}`,
    `URL: ${url}`,
    `Вопрос/контекст поля: ${context}`,
    '',
    'Текст вакансии:',
    vacancyText || 'Текст вакансии не удалось прочитать.',
    '',
    'Резюме кандидата:',
    resume || 'Резюме не заполнено.',
    '',
    'Зарплатные ожидания и правила ответа о деньгах:',
    salaryText,
    '',
    'Релевантные фрагменты базы знаний:',
    knowledgeText,
    '',
    task
  ].join('\n');

  await appendDeepSeekDebug({
    phase: 'request',
    kind,
    title,
    url,
    context,
    vacancyTextPreview: (vacancyText || '').slice(0, 1000),
    salaryIncluded: kind === 'salary',
    model,
    knowledgeFiles: knowledgeChunks.map((chunk) => chunk.file),
    userPromptPreview: user.slice(0, 3000)
  }, debugAi);

  const result = await callDeepSeek({
    apiKey,
    apiUrl,
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.2,
    maxTokens: kind === 'coverLetter' ? 180 : 160
  });

  if (!result.ok) {
    await appendDeepSeekDebug({ phase: 'error', status: result.status, body: result.body?.slice(0, 1000) }, debugAi);
    return '';
  }

  const rawAnswer = result.content;
  const answer = cleanGeneratedAnswer(rawAnswer);
  const safeAnswer = kind === 'coverLetter' && looksLikeEmployerVoice(answer) ? '' : answer;

  await appendDeepSeekDebug({
    phase: 'response',
    kind,
    context,
    rawAnswer,
    cleanedAnswer: safeAnswer,
    rejectedEmployerVoice: kind === 'coverLetter' && looksLikeEmployerVoice(answer)
  }, debugAi);

  return safeAnswer;
}

async function askDeepSeekChoice({
  group,
  title,
  url,
  vacancyText,
  resume,
  salary,
  knowledgeBase,
  apiKey,
  apiUrl,
  model,
  debugAi
}) {
  if (!apiKey) return [];

  const context = [
    group.question,
    ...group.options.map((option) => option.label)
  ].join('\n');
  const includeSalary = isSalaryContext(context);
  // Для salary-контекста RAG не нужен: ответ берётся только из salary.md.
  const knowledgeChunks = includeSalary
    ? []
    : pickKnowledgeChunks(`${title}\n${context}\n${vacancyText || ''}`, knowledgeBase);
  const knowledgeText = knowledgeChunks.length
    ? knowledgeChunks.map((chunk, index) => `[${index + 1}] ${chunk.file}\n${chunk.text}`).join('\n\n')
    : 'Нет релевантных фрагментов базы знаний.';

  const system = [
    'Ты выбираешь варианты ответа в форме отклика на вакансию.',
    'Отвечай только JSON-объектом без markdown.',
    'Формат строго такой: {"choices":["точный текст варианта"]}.',
    'Выбирай только из переданного списка вариантов, не придумывай новые.',
    'Для radio выбери ровно один вариант. Для checkbox можно выбрать один или несколько.',
    'Опирайся на резюме и базу знаний. Зарплатные ожидания используй только если вопрос явно про зарплату. Если нельзя честно выбрать, верни {"choices":[]}.'
  ].join(' ');

  const user = [
    `Тип выбора: ${group.type}`,
    `Вакансия: ${title}`,
    `URL: ${url}`,
    `Вопрос: ${group.question}`,
    '',
    'Текст вакансии:',
    vacancyText || 'Текст вакансии не удалось прочитать.',
    '',
    'Варианты:',
    ...group.options.map((option, index) => `${index + 1}. ${option.label}`),
    '',
    'Резюме кандидата:',
    resume || 'Резюме не заполнено.',
    '',
    'Зарплатные ожидания:',
    includeSalary ? (salary || 'Зарплатные ожидания не заполнены.') : 'Не использовать: вопрос не про зарплату.',
    '',
    'Релевантные фрагменты базы знаний:',
    knowledgeText
  ].join('\n');

  await appendDeepSeekDebug({
    phase: 'choice-request',
    kind: group.type,
    title,
    url,
    question: group.question,
    options: group.options.map((option) => option.label),
    salaryIncluded: includeSalary,
    model,
    userPromptPreview: user.slice(0, 3000)
  }, debugAi);

  const result = await callDeepSeek({
    apiKey,
    apiUrl,
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0,
    maxTokens: 160
  });

  if (!result.ok) {
    await appendDeepSeekDebug({ phase: 'choice-error', status: result.status, body: result.body?.slice(0, 1000) }, debugAi);
    return [];
  }

  const rawAnswer = result.content;
  let choices = [];

  try {
    const parsed = parseJsonObject(rawAnswer);
    choices = Array.isArray(parsed.choices) ? parsed.choices.map(String) : [];
  } catch {
    choices = [];
  }

  await appendDeepSeekDebug({
    phase: 'choice-response',
    kind: group.type,
    question: group.question,
    rawAnswer,
    choices
  }, debugAi);

  return choices;
}

async function pageHasRequiredManualStep(page) {
  const visibleText = await getVisibleText(page);
  return matchesAnyPattern(visibleText, REQUIRED_MANUAL_PATTERNS);
}

async function pageLooksApplied(page) {
  const visibleText = await getVisibleText(page);
  return isAlreadyApplied(visibleText);
}

async function clickFirstVisibleByText(page, texts) {
  for (const text of texts) {
    for (const locator of [
      page.getByRole('button', { name: text }),
      page.getByRole('link', { name: text })
    ]) {
      const count = Math.min(await locator.count().catch(() => 0), 8);

      for (let index = count - 1; index >= 0; index -= 1) {
        const control = locator.nth(index);

        if (
          !(await control.isVisible().catch(() => false)) ||
          !(await control.isEnabled().catch(() => true))
        ) {
          continue;
        }

        try {
          await control.click({ timeout: 2500 });
          return true;
        } catch (error) {
          const message = String(error?.message || '');
          if (/intercepts pointer events|Timeout \d+ms exceeded|not receive pointer events/i.test(message)) {
            continue;
          }
          throw error;
        }
      }
    }
  }

  return false;
}

async function selectFirstResumeOption(page) {
  const visibleText = await getVisibleText(page);
  if (!/выберите резюме|резюме для отклика|каким резюме/i.test(visibleText)) {
    return false;
  }

  const radio = page.getByRole('radio').first();
  if (await radio.isVisible().catch(() => false)) {
    await radio.click().catch(() => {});
    return true;
  }

  return false;
}

async function openCoverLetterEditor(page) {
  const pageText = await getVisibleText(page);
  if (!coverLetterRequired(pageText)) {
    return false;
  }

  const clicked = await page.evaluate(() => {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const isVisible = (node) => {
      if (!node || !(node instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && node.offsetParent !== null;
    };

    const controls = [...document.querySelectorAll('button, a, [role="button"]')];
    for (const control of controls) {
      if (!isVisible(control)) continue;
      if (!/^Добавить$/i.test(clean(control.textContent))) continue;

      let node = control;
      for (let depth = 0; depth < 5 && node; depth += 1) {
        const text = clean(node.textContent);
        if (/Сопроводительное письмо/i.test(text)) {
          control.click();
          return true;
        }
        node = node.parentElement;
      }
    }

    return false;
  }).catch(() => false);

  if (clicked) {
    console.log('Открыл поле сопроводительного письма.');
    await page.waitForTimeout(500);
  }

  return clicked;
}

async function getFieldContext(field) {
  return field.evaluate((element) => {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const isVisible = (node) => {
      if (!node || !(node instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && node.offsetParent !== null;
    };
    const add = (items, text) => {
      const cleaned = clean(text);
      if (!cleaned) return;
      if (/^(писать тут|write here)$/i.test(cleaned)) return;
      if (!items.includes(cleaned)) items.push(cleaned);
    };

    const items = [];

    add(items, element.getAttribute('aria-label'));
    add(items, element.getAttribute('placeholder'));

    const id = element.getAttribute('id');
    const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    add(items, label?.textContent);

    let node = element;
    for (let depth = 0; depth < 5 && node; depth += 1) {
      let sibling = node.previousElementSibling;
      let seen = 0;

      while (sibling && seen < 4) {
        if (isVisible(sibling)) {
          const text = clean(sibling.textContent);
          if (text && text.length <= 500) {
            add(items, text);
            seen += 1;
          }
        }
        sibling = sibling.previousElementSibling;
      }

      node = node.parentElement;
    }

    const technicalName = element.getAttribute('name');
    if (items.length === 0 && !/^task_\d+_text$/i.test(technicalName || '')) {
      add(items, technicalName);
    }

    return items.slice(0, 8).join('\n');
  }).catch(() => '');
}

async function fillDeepSeekTextFields(page, deepSeekContext, vacancy) {
  let filled = 0;
  const fields = page.locator('textarea, input[type="text"]');
  const count = await fields.count().catch(() => 0);
  const pageText = await getVisibleText(page);

  for (let index = 0; index < count; index += 1) {
    const field = fields.nth(index);

    if (!(await field.isVisible().catch(() => false))) continue;
    if (!(await field.isEditable().catch(() => false))) continue;
    if ((await field.getAttribute('data-deepseek-attempted').catch(() => '')) === '1') continue;

    const currentValue = await field.inputValue().catch(() => '');
    if (currentValue.trim()) continue;

    const context = await getFieldContext(field);
    const kind = detectFieldKind(context, pageText);
    const mainQuestion = getMainQuestion(context);

    if (kind === 'unknown') {
      console.log(`Поле ${index + 1}: пропускаю, не удалось понять контекст.`);
      await field.evaluate((element) => element.setAttribute('data-deepseek-attempted', '1')).catch(() => {});
      continue;
    }

    console.log(`Поле ${index + 1}: ${kind}; вопрос: ${mainQuestion}`);
    await field.evaluate((element) => element.setAttribute('data-deepseek-attempted', '1')).catch(() => {});

    const textToFill = await askDeepSeek({
      kind,
      context,
      title: vacancy.title,
      url: vacancy.url,
      vacancyText: vacancy.text,
      ...deepSeekContext
    });

    if (!textToFill) continue;

    await field.fill(textToFill);
    filled += 1;
  }

  if (filled > 0) {
    console.log(`Заполнил текстовые поля через DeepSeek: ${filled}.`);
  }

  return filled;
}

async function getChoiceGroups(page) {
  return page.evaluate(() => {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const isVisible = (node) => {
      if (!node || !(node instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && node.offsetParent !== null;
    };
    const getLabel = (input) => {
      const id = input.getAttribute('id');
      const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const implicit = input.closest('label');
      const label = explicit || implicit;
      if (label) {
        return clean(label.textContent).replace(/^[✓✔]\s*/, '');
      }

      const parent = input.parentElement;
      return clean(parent?.textContent || input.getAttribute('aria-label') || input.value || '');
    };
    const getQuestion = (input, optionLabels) => {
      const items = [];
      const add = (text) => {
        const value = clean(text);
        if (!value) return;
        if (optionLabels.includes(value)) return;
        if (/^(да|нет)$/i.test(value)) return;
        if (value.length > 700) return;
        if (!items.includes(value)) items.push(value);
      };

      let node = input.closest('label') || input;
      for (let depth = 0; depth < 6 && node; depth += 1) {
        let sibling = node.previousElementSibling;
        let seen = 0;

        while (sibling && seen < 4) {
          if (isVisible(sibling)) {
            const text = clean(sibling.textContent);
            if (text) {
              add(text);
              seen += 1;
            }
          }
          sibling = sibling.previousElementSibling;
        }

        node = node.parentElement;
      }

      return items[0] || clean(input.closest('fieldset')?.querySelector('legend')?.textContent) || 'Вопрос с вариантами ответа';
    };

    const inputs = [...document.querySelectorAll('input[type="checkbox"], input[type="radio"]')];
    const groups = new Map();

    inputs.forEach((input, index) => {
      if (!(input instanceof HTMLInputElement)) return;
      if (input.disabled) return;

      const label = getLabel(input);
      if (!label) return;

      const type = input.type;
      const name = input.name || `${type}_${index}`;
      const key = `${type}:${name}`;

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          type,
          name,
          options: []
        });
      }

      groups.get(key).options.push({
        index,
        label,
        checked: input.checked
      });
    });

    return [...groups.values()]
      .map((group) => ({
        ...group,
        question: getQuestion(inputs[group.options[0].index], group.options.map((option) => option.label))
      }))
      .filter((group) => group.options.length > 0 && group.options.some((option) => !option.checked));
  }).catch(() => []);
}

async function fillDeepSeekChoiceGroups(page, deepSeekContext, vacancy) {
  let selected = 0;
  const groups = await getChoiceGroups(page);
  const choiceInputs = page.locator('input[type="checkbox"], input[type="radio"]');

  for (const group of groups) {
    const firstInput = choiceInputs.nth(group.options[0].index);
    if ((await firstInput.getAttribute('data-deepseek-attempted').catch(() => '')) === '1') continue;
    await firstInput.evaluate((element) => element.setAttribute('data-deepseek-attempted', '1')).catch(() => {});

    console.log(`Выбор ${group.type}: ${group.question}`);

    const choices = await askDeepSeekChoice({
      group,
      title: vacancy.title,
      url: vacancy.url,
      vacancyText: vacancy.text,
      ...deepSeekContext
    });

    if (choices.length === 0) continue;

    const selectedOptions = group.options.filter((option) =>
      choices.some((choice) => optionMatches(option.label, choice))
    );

    for (const option of selectedOptions) {
      const input = choiceInputs.nth(option.index);
      await input.check({ force: true }).catch(async () => {
        await input.click({ force: true }).catch(() => {});
      });
      selected += 1;

      if (group.type === 'radio') break;
    }
  }

  if (selected > 0) {
    console.log(`Выбрал варианты через DeepSeek: ${selected}.`);
  }

  return selected;
}

async function collectTextFields(page) {
  const fields = page.locator('textarea, input[type="text"]');
  const count = await fields.count().catch(() => 0);
  const pageText = await getVisibleText(page);
  const result = [];

  for (let index = 0; index < count; index += 1) {
    const field = fields.nth(index);
    if (!(await field.isVisible().catch(() => false))) continue;
    if (!(await field.isEditable().catch(() => false))) continue;
    if ((await field.getAttribute('data-deepseek-attempted').catch(() => '')) === '1') continue;

    const currentValue = await field.inputValue().catch(() => '');
    if (currentValue.trim()) continue;

    const context = await getFieldContext(field);
    const kind = detectFieldKind(context, pageText);
    if (kind === 'unknown') continue;

    result.push({
      index,
      kind,
      question: getMainQuestion(context),
      context
    });
  }

  return result;
}

async function askDeepSeekForm({ fields, choiceGroups, vacancy, deepSeekContext }) {
  const { resume, salary, knowledgeBase, apiKey, apiUrl, model, debugAi } = deepSeekContext;
  if (!apiKey) return { fields: [], choices: [] };

  const allContexts = [
    vacancy.title,
    vacancy.text,
    ...fields.filter((field) => field.kind !== 'coverLetter').map((field) => field.context),
    ...choiceGroups.map((group) => [group.question, ...group.options.map((option) => option.label)].join('\n'))
  ].join('\n');
  const needsKnowledge = fields.some((field) => field.kind !== 'coverLetter') || choiceGroups.length > 0;
  const needsSalary = fields.some((field) => field.kind === 'salary') || choiceGroups.some((group) => isSalaryContext(group.question));
  const knowledgeChunks = needsKnowledge ? pickKnowledgeChunks(allContexts, knowledgeBase) : [];
  const knowledgeText = knowledgeChunks.length
    ? knowledgeChunks.map((chunk, index) => `[${index + 1}] ${chunk.file}\n${chunk.text}`).join('\n\n')
    : 'Не использовать базу знаний для этой формы.';

  const system = [
    'Ты заполняешь одну форму отклика на вакансию.',
    'Отвечай только JSON-объектом без markdown.',
    'Формат строго: {"fields":[{"index":0,"value":"текст"}],"choices":[{"key":"checkbox:name","choices":["точный текст варианта"]}]}',
    'Для text fields используй index из списка полей. Для choices используй key из списка групп.',
    'Сопроводительное письмо: 1-2 предложения, без приветствия, без имени, без плейсхолдеров, цель — приглашение на собеседование.',
    'Сопроводительное письмо всегда от лица кандидата, не работодателя и не рекрутера.',
    'Запрещены фразы от лица собеседующего: "ваш опыт релевантен", "готов пригласить", "мы пригласим", "рассмотрим вашу кандидатуру", "подходите нашей компании".',
    'В сопроводительном письме желательно избегать местоимения "я"; используй нейтральные формулировки: "есть опыт", "готовность", "практический опыт", "интересны задачи".',
    'Для зарплаты верни только сумму или вилку из зарплатных ожиданий.',
    'Зарплатные ожидания используй только для salary-полей или salary-вопросов.',
    'Для checkbox можно выбрать несколько вариантов, для radio ровно один.',
    'Если для поля нельзя честно ответить, не добавляй его в fields/choices.',
    'Не выдумывай личные факты, места работы, проекты и контакты.'
  ].join(' ');

  const user = [
    `Вакансия: ${vacancy.title}`,
    `URL: ${vacancy.url}`,
    '',
    'Текст вакансии:',
    vacancy.text || 'Текст вакансии не удалось прочитать.',
    '',
    'Поля для заполнения:',
    fields.length
      ? fields.map((field) => `- index=${field.index}; kind=${field.kind}; question=${field.question}; context=${field.context}`).join('\n')
      : 'Нет текстовых полей.',
    '',
    'Группы вариантов:',
    choiceGroups.length
      ? choiceGroups.map((group) => [
          `- key=${group.key}; type=${group.type}; question=${group.question}`,
          ...group.options.map((option, index) => `  ${index + 1}. ${option.label}`)
        ].join('\n')).join('\n')
      : 'Нет checkbox/radio групп.',
    '',
    'Резюме кандидата:',
    resume || 'Резюме не заполнено.',
    '',
    'Зарплатные ожидания:',
    needsSalary ? (salary || 'Зарплатные ожидания не заполнены.') : 'Не использовать: в форме нет salary-вопросов.',
    '',
    'Релевантные фрагменты базы знаний:',
    knowledgeText
  ].join('\n');

  await appendDeepSeekDebug({
    phase: 'form-request',
    title: vacancy.title,
    url: vacancy.url,
    fieldCount: fields.length,
    choiceGroupCount: choiceGroups.length,
    salaryIncluded: needsSalary,
    knowledgeFiles: knowledgeChunks.map((chunk) => chunk.file),
    userPromptPreview: user.slice(0, 4000)
  }, debugAi);

  const result = await callDeepSeek({
    apiKey,
    apiUrl,
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.1,
    maxTokens: 1000
  });

  if (!result.ok) {
    await appendDeepSeekDebug({ phase: 'form-error', status: result.status, body: result.body?.slice(0, 1000) }, debugAi);
    return { fields: [], choices: [] };
  }

  let parsed = { fields: [], choices: [] };
  try {
    parsed = parseJsonObject(result.content);
  } catch {}

  const normalized = {
    fields: Array.isArray(parsed.fields) ? parsed.fields : [],
    choices: Array.isArray(parsed.choices) ? parsed.choices : []
  };

  await appendDeepSeekDebug({
    phase: 'form-response',
    title: vacancy.title,
    url: vacancy.url,
    rawAnswer: result.content,
    parsed: normalized
  }, debugAi);

  return normalized;
}

async function fillDeepSeekFormBatch(page, deepSeekContext, vacancy) {
  const fields = await collectTextFields(page);
  const choiceGroups = await getChoiceGroups(page);

  if (fields.length === 0 && choiceGroups.length === 0) {
    return 0;
  }

  console.log(`Форма: текстовых полей ${fields.length}, групп выбора ${choiceGroups.length}.`);

  const answer = await askDeepSeekForm({ fields, choiceGroups, vacancy, deepSeekContext });
  const textInputs = page.locator('textarea, input[type="text"]');
  const choiceInputs = page.locator('input[type="checkbox"], input[type="radio"]');
  let filled = 0;

  for (const field of fields) {
    const input = textInputs.nth(field.index);
    await input.evaluate((element) => element.setAttribute('data-deepseek-attempted', '1')).catch(() => {});
  }

  for (const fieldAnswer of answer.fields) {
    const index = Number(fieldAnswer.index);
    const value = cleanGeneratedAnswer(String(fieldAnswer.value || ''));
    if (!Number.isInteger(index) || !value) continue;

    const sourceField = fields.find((field) => field.index === index);
    if (sourceField?.kind === 'coverLetter' && looksLikeEmployerVoice(value)) {
      console.log('Сопроводительное похоже на текст от лица работодателя, не вставляю.');
      continue;
    }

    const input = textInputs.nth(index);
    if (!(await input.isVisible().catch(() => false))) continue;
    if ((await input.inputValue().catch(() => '')).trim()) continue;

    await input.fill(value);
    filled += 1;
  }

  for (const group of choiceGroups) {
    const firstInput = choiceInputs.nth(group.options[0].index);
    await firstInput.evaluate((element) => element.setAttribute('data-deepseek-attempted', '1')).catch(() => {});

    const groupAnswer = answer.choices.find((item) => item.key === group.key);
    const choices = Array.isArray(groupAnswer?.choices) ? groupAnswer.choices.map(String) : [];
    if (choices.length === 0) continue;

    const selectedOptions = group.options.filter((option) =>
      choices.some((choice) => optionMatches(option.label, choice))
    );

    for (const option of selectedOptions) {
      const input = choiceInputs.nth(option.index);
      await input.check({ force: true }).catch(async () => {
        await input.click({ force: true }).catch(() => {});
      });
      filled += 1;

      if (group.type === 'radio') break;
    }
  }

  if (filled > 0) {
    console.log(`Заполнил форму одним запросом DeepSeek: ${filled}.`);
  }

  return filled;
}

async function completeApplicationFlow(page, deepSeekContext, vacancy, { dryRun = false } = {}) {
  // Defense-in-depth: блокируем отправку, если --dry-run активен (на случай вызова иным путём).
  if (!isSubmitAllowed({ dryRun })) return { status: 'dry_run' };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await dismissHarmlessPopups(page);

    if (await pageLooksApplied(page)) {
      return { status: 'clicked' };
    }

    await openCoverLetterEditor(page);
    await fillDeepSeekFormBatch(page, deepSeekContext, vacancy);

    if (await pageHasRequiredManualStep(page)) {
      console.log('Открылся тест, анкета или обязательные вопросы, на которые DeepSeek не дал подходящий ответ. Пропускаю вакансию и иду дальше.');
      return { status: 'manual_needed' };
    }

    await selectFirstResumeOption(page);

    const clicked = await clickFirstVisibleByText(page, APPLICATION_FLOW_BUTTON_TEXTS);
    if (!clicked) {
      return { status: 'clicked' };
    }

    await page.waitForTimeout(1200);
  }

  if (await pageHasRequiredManualStep(page)) {
    console.log('Открылся тест, анкета или обязательные вопросы, на которые DeepSeek не дал подходящий ответ. Пропускаю вакансию и иду дальше.');
    return { status: 'manual_needed' };
  }

  return { status: 'clicked' };
}

async function pageLooksLikeManualStep(page) {
  const visibleText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  return matchesAnyPattern(visibleText, REQUIRED_MANUAL_PATTERNS);
}

async function appendLog(entry, account = 'default') {
  await appendFile(getAccountLogPath(account), `${JSON.stringify({ ...entry, account, at: new Date().toISOString() })}\n`);
}

async function reviewVacancy(page, url, index, total, { account = 'default', autoApply = false, dryRun = false, deepSeekContext, resumeUpgradeCollector, scoreCache = null, resumeHash = '' } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await dismissHarmlessPopups(page);
  await page.waitForTimeout(700);

  const title = await page.locator('h1').first().innerText({ timeout: 3000 }).catch(() => 'Без заголовка');
  const vacancyText = await getVacancyText(page);
  console.log(`\n[${account}] [${index}/${total}] ${title}`);
  console.log(url);

  if (await pageLooksApplied(page)) {
    console.log('Уже откликнулись на эту вакансию — скоринг DeepSeek и автоотклик пропускаю (0 токенов).');
    return { status: 'already_applied', title };
  }

  const key = scoreCache ? cacheKey(url, resumeHash) : '';
  const cachedRelevance = key ? getCached(scoreCache, key) : null;

  let relevance;
  if (cachedRelevance) {
    relevance = cachedRelevance;
    console.log('Релевантность из кэша (0 токенов).');
  } else {
    const local = localRelevanceScore(vacancyText, deepSeekContext.resume);
    // Локальный reject не должен быть строже порога пользователя: low не выше minScore-1.
    const localLow = Math.min(40, deepSeekContext.minScore - 1);
    if (needsModelScoring(local, { low: localLow })) {
      relevance = await scoreVacancyWithDeepSeek({
        title,
        url,
        vacancyText,
        ...deepSeekContext
      });
    } else {
      relevance = { score: local.score, reason: `локальный скоринг: совпало ${local.overlap}/${local.demanded} навыков` };
      console.log('DeepSeek по релевантности пропущен: уверенный локальный скоринг (0 токенов).');
    }
    if (key && !relevance.aiFailed) {
      setCached(scoreCache, key, relevance);
    }
  }
  console.log(`Релевантность: ${relevance.score}/100${relevance.reason ? ` — ${relevance.reason}` : ''}`);

  await collectResumeUpgradeSignals(page, resumeUpgradeCollector, { title, url, text: vacancyText }, relevance);

  if (relevance.aiFailed) {
    if (relevance.aiStatus === 402) {
      console.log('DeepSeek недоступен: недостаточно баланса. Автоотклик по этой вакансии пропускаю.');
    } else {
      console.log('DeepSeek не смог оценить релевантность. Автоотклик по этой вакансии пропускаю.');
    }
    return { status: 'manual_needed', title, relevance };
  }

  if (relevance.score < deepSeekContext.minScore) {
    console.log(`Пропускаю: ниже порога ${deepSeekContext.minScore}.`);
    return { status: 'skipped', title, relevance };
  }

  // Главный гард --dry-run: скоринг выполнен, но отправка запрещена.
  // Стоит ДО findResponseButton, клика RESPONSE_BUTTON_TEXTS и completeApplicationFlow.
  if (!isSubmitAllowed({ dryRun })) {
    console.log('DRY-RUN: вакансия выше порога — откликнулся бы, но --dry-run активен. Отправку пропускаю.');
    return { status: 'dry_run', title, relevance };
  }

  if (await pageLooksLikeManualStep(page)) {
    console.log('На странице уже видны признаки анкеты/теста/обязательных вопросов.');
  }

  const responseButton = await findResponseButton(page);
  if (!responseButton) {
    console.log('Кнопка отклика не найдена.');
    return { status: 'manual_needed', title };
  }

  const command = autoApply
    ? 'y'
    : (await ask('Действие: y=откликнуться, n=пропустить, m=ручное действие, q=выйти: ')).toLowerCase();

  if (autoApply) {
    console.log('Автоматический режим: выбираю y.');
  }

  if (command === 'q') return { status: 'quit', title };
  if (command === 'm') return { status: 'manual_needed', title };
  if (command !== 'y') return { status: 'skipped', title };

  if (!(await clickFirstVisibleByText(page, RESPONSE_BUTTON_TEXTS))) {
    console.log('Не смог нажать кнопку отклика: поверх страницы осталось модальное окно или перекрывающий слой.');
    return { status: 'manual_needed', title };
  }
  await page.waitForTimeout(1200);

  const flowResult = await completeApplicationFlow(page, deepSeekContext, { title, url, text: vacancyText }, { dryRun });
  if (flowResult.status === 'manual_needed') return { status: 'manual_needed', title };

  console.log('Отклик отправлен или технический шаг завершен автоматически.');
  return { status: 'clicked', title };
}

await ensureAppDirs();
await loadEnvFile(envPath);

const args = parseArgs(process.argv.slice(2));
const missingAccounts = args.accounts.filter((account) => !existsSync(getAccountStorageStatePath(account)));
if (missingAccounts.length > 0) {
  console.error(`Нет сохраненной сессии для аккаунтов: ${missingAccounts.join(', ')}.`);
  console.error('Сначала выполните: npm.cmd run login -- --account <account>');
  process.exit(1);
}

const minScoreFromEnv = Number(process.env.RELEVANCE_MIN_SCORE);
const sharedDeepSeekContext = {
  knowledgeBase: await loadKnowledgeBase(dataDir),
  apiKey: process.env.DEEPSEEK_API_KEY || '',
  apiUrl: process.env.DEEPSEEK_API_URL || DEFAULT_DEEPSEEK_API_URL,
  model: process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
  debugAi: args.debugAi || process.env.DEBUG_DEEPSEEK === '1',
  minScore: Number.isFinite(minScoreFromEnv) ? minScoreFromEnv : args.minScore
};

if (args.ai && !sharedDeepSeekContext.apiKey) {
  console.error('Нет DEEPSEEK_API_KEY. Вставьте ключ в .env или задайте переменную окружения.');
  process.exit(1);
}

async function buildDeepSeekContextForAccount(account, sharedContext) {
  await mkdir(getAccountConfigDir(account), { recursive: true });
  const resumePath = getAccountResumePath(account);
  const salaryPath = getAccountSalaryPath(account);

  if (!existsSync(resumePath)) {
    await writeFile(resumePath, RESUME_TEMPLATE, 'utf8');
    console.log(`[${account}] Создал шаблон резюме: ${resumePath}`);
  }

  if (!existsSync(salaryPath)) {
    await writeFile(salaryPath, SALARY_TEMPLATE, 'utf8');
    console.log(`[${account}] Создал шаблон зарплатных ожиданий: ${salaryPath}`);
  }

  const resume = stripTemplateText(await readOptionalText(resumePath), [
    'Заполните здесь краткую информацию из резюме',
    'Заполните резюме для этого аккаунта'
  ]);
  const salary = stripTemplateText(await readOptionalText(salaryPath), [
    'Замените этот текст на реальные зарплатные ожидания'
  ]);

  return {
    ...sharedContext,
    resume,
    salary,
    resumePath,
    salaryPath
  };
}

async function collectVacanciesForAccount(page, args, account) {
  let fromSearch = [];

  if (args.search) {
    console.log(`[${account}] Собираю вакансии из поиска.`);
    fromSearch = await collectFromSearch(page, args.search, args.limit);
  }

  const fromFile = await readVacancyFile(args.file);
  return [...new Set([...fromSearch, ...fromFile])].slice(0, args.limit);
}

async function processAccount(account, args, sharedDeepSeekContext) {
  const deepSeekContext = await buildDeepSeekContextForAccount(account, sharedDeepSeekContext);
  const resumeUpgradeCollector = args.upgradeResume ? createResumeUpgradeCollector(account) : null;
  const scoreCache = await loadCache(scoreCachePath);
  const resumeHash = hashResume(deepSeekContext.resume);
  const { browser, page } = await launchBrowser({ account, useSavedSession: true });

  try {
    const vacancies = await collectVacanciesForAccount(page, args, account);

    if (vacancies.length === 0) {
      console.log(`[${account}] Не нашел вакансии. Добавьте ссылки в input/vacancies.txt или передайте --search/--text.`);
      return;
    }

    console.log(`[${account}] Найдено вакансий: ${vacancies.length}.`);

    for (let index = 0; index < vacancies.length; index += 1) {
      const url = vacancies[index];

      try {
        const result = await reviewVacancy(page, url, index + 1, vacancies.length, {
          account,
          autoApply: args.autoApply,
          dryRun: args.dryRun,
          deepSeekContext,
          resumeUpgradeCollector,
          scoreCache,
          resumeHash
        });
        await appendLog({ url, ...result }, account);
        if (result.status === 'quit') break;
      } catch (error) {
        console.error(`[${account}] Ошибка на ${url}: ${error.message}`);
        await appendLog({ url, status: 'error', error: error.message }, account);
      }
    }

    await finishResumeUpgradeReport({
      account,
      collector: resumeUpgradeCollector,
      deepSeekContext,
      skillsLimit: args.resumeSkillsLimit
    });
  } finally {
    await saveCache(scoreCachePath, scoreCache);
    // Закрытие — best-effort: ошибка close не должна ронять прогон других аккаунтов.
    await browser.close().catch(() => {});
  }
}

if (args.autoApply) {
  console.log('Включен автоматический режим: скрипт будет сам выбирать y для найденных кнопок отклика.');
}

console.log(`Аккаунты: ${args.accounts.join(', ')}.`);
console.log(`DeepSeek включен: ${sharedDeepSeekContext.model}. Фрагментов базы знаний: ${sharedDeepSeekContext.knowledgeBase.length}.`);

if (args.autoApply) {
  const jobs = args.accounts.map((account) => processAccount(account, args, sharedDeepSeekContext));
  await Promise.all(jobs);
} else {
  for (const account of args.accounts) {
    await processAccount(account, args, sharedDeepSeekContext);
  }
}

console.log(runUsageCounter.formatSummary());
