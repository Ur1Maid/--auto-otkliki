// Батч-скоринг вакансий: N вакансий одним вызовом DeepSeek.
// Переиспользуемый блок для демона (M7); в интерактивный флоу review.js НЕ встроен.
//
// Экспортируемые функции:
//   buildBatchScoreMessages(vacancies, resumeProfile)
//     → [{ role:'system', content }, { role:'user', content }]   (чистая, без сети)
//
//   scoreVacanciesBatch(vacancies, params, deps)
//     → Promise<[{ id, score, reason, aiFailed? }]>

import { callDeepSeek as realCallDeepSeek } from './deepseek.js';
import { parseJsonObject } from './text.js';
import { extractRequirements } from './vacancyExtract.js';

// ---------------------------------------------------------------------------
// Построение messages для батч-скоринга.
// Чистая функция: без сети, без сайд-эффектов.
// ---------------------------------------------------------------------------

/**
 * @param {Array<{ id: any, title?: any, text?: any }>} vacancies
 * @param {string} resumeProfile  — уже построенная строка профиля (buildResumeProfile)
 * @returns {[{ role: 'system', content: string }, { role: 'user', content: string }]}
 */
export function buildBatchScoreMessages(vacancies, resumeProfile) {
  const profile = typeof resumeProfile === 'string' ? resumeProfile : '';
  const list = Array.isArray(vacancies) ? vacancies : [];

  const system = [
    'Ты оцениваешь релевантность вакансий кандидату.',
    'Оцени релевантность КАЖДОЙ вакансии резюме кандидата.',
    'Верни СТРОГО JSON-объект вида {"results":[{"id":<id>,"score":<0-100>,"reason":"<кратко>"}]}',
    'для ВСЕХ переданных вакансий, по одному элементу на вакансию, тот же id.',
    'Только JSON, без markdown.',
    'score от 0 до 100, высокий = стоит откликаться.',
    'Не выдумывай опыт, места работы, проекты, контакты, имя кандидата.',
  ].join(' ');

  const vacancyBlocks = list.map((v) => {
    const id = v?.id ?? '';
    const title = typeof v?.title === 'string' ? v.title : String(v?.title ?? '');
    const text = typeof v?.text === 'string' ? v.text : String(v?.text ?? '');
    const requirements = extractRequirements(text);
    return [
      `--- Вакансия id=${id} ---`,
      `id: ${id}`,
      `Заголовок: ${title}`,
      `Требования: ${requirements}`,
    ].join('\n');
  }).join('\n\n');

  const user = [
    `Профиль кандидата (резюме): ${profile}`,
    '',
    vacancyBlocks || '(нет вакансий)',
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user',   content: user   },
  ];
}

// ---------------------------------------------------------------------------
// Скоринг батча: один вызов DeepSeek на N вакансий.
// callDeepSeek внедряется через deps — позволяет мокировать в тестах без сети.
// ---------------------------------------------------------------------------

/**
 * Рекомендация по размеру батча: держи N <= ~20. maxTokens на выход капится 1200,
 * при больших N JSON может обрезаться → весь батч деградирует в missing_in_batch
 * (без падения, но впустую). Потребитель (демон M7) сам делит на батчи.
 *
 * @param {Array<{ id: any, title?: any, text?: any }>} vacancies
 * @param {{ resumeProfile?: string, apiKey?: string, apiUrl?: string, model?: string }} params
 * @param {{ callDeepSeek?: Function }} deps
 * @returns {Promise<Array<{ id: any, score: number, reason: string, aiFailed?: true, aiStatus?: number }>>}
 */
export async function scoreVacanciesBatch(vacancies, params = {}, deps = {}) {
  // Пустой или не-массив → пусто, callDeepSeek не зовём.
  if (!Array.isArray(vacancies) || vacancies.length === 0) return [];

  const { resumeProfile = '', apiKey, apiUrl, model } = params;
  const callDeepSeek = deps.callDeepSeek ?? realCallDeepSeek;

  // Нет ключа → не зовём сеть, все вакансии получают aiFailed.
  if (!apiKey) {
    return vacancies.map((v) => ({
      id: v?.id ?? '',
      score: 0,
      reason: 'no_key',
      aiFailed: true,
    }));
  }

  const messages = buildBatchScoreMessages(vacancies, resumeProfile);

  // maxTokens: ~50 токенов на результат, с кэпом 1200.
  const maxTokens = Math.min(60 * vacancies.length, 1200);

  // try/catch: реальный callDeepSeek не бросает, но внедрённый (демон M7) мог бы —
  // контракт «не бросать из AI-функции» держим здесь явно.
  let result;
  try {
    result = await callDeepSeek({
      apiKey,
      apiUrl,
      model,
      messages,
      temperature: 0,
      maxTokens,
    });
  } catch {
    result = { ok: false, status: 0 };
  }

  // Сбой API → все aiFailed, не бросаем.
  if (!result || !result.ok) {
    const reason = result.status === 402
      ? 'deepseek_insufficient_balance'
      : 'relevance_check_failed';
    return vacancies.map((v) => ({
      id: v?.id ?? '',
      score: 0,
      reason,
      aiFailed: true,
      aiStatus: result.status,
    }));
  }

  // Парсим ответ; модель просили вернуть {"results":[...]}.
  let parsed;
  try {
    parsed = parseJsonObject(result.content);
  } catch {
    parsed = null;
  }

  const rawResults = Array.isArray(parsed?.results) ? parsed.results : [];

  // Строим Map по id для быстрого поиска.
  const byId = new Map();
  for (const item of rawResults) {
    // typeof-guard: 'id' in <примитив> бросает TypeError — не даём упасть на битом results.
    if (item != null && typeof item === 'object' && 'id' in item) {
      byId.set(String(item.id), item);
    }
  }

  // Выравниваем по порядку входных вакансий.
  return vacancies.map((v) => {
    const id = v?.id ?? '';
    const found = byId.get(String(id));

    if (!found) {
      // Модель ответила, но пропустила этот id — не aiFailed, потребитель решит сам.
      return { id, score: 0, reason: 'missing_in_batch' };
    }

    const rawScore = Number(found.score);
    const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0;
    const reason = String(found.reason ?? '').slice(0, 300);

    return { id, score, reason };
  });
}
