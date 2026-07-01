/**
 * src/lib/dashboardData.js — сборщики данных панели hh-auto-otkliki (вынесены из dashboard.js).
 *
 * Зачем: следить за откликами, конверсией, токенами/стоимостью, сообщениями и резюме.
 * Только Node-builtins (fs) — читает logs/ и config/accounts/. Никакой сети/браузера.
 *
 * Безопасность:
 *   - В выдачу идут ЧИСЛА и статусы; заголовки/URL вакансий и любой PII НЕ отдаются
 *     (агрегаторы в lib/metrics.js считают только счётчики).
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { logsDir, statusDir, resourcesLogPath, accountsConfigDir, getAccountLogPath } from '../config.js';
import {
  parseJsonl,
  aggregateResponses,
  aggregateSummaries,
  aggregateDaily,
  estimateCost,
  computeFunnel,
  aggregateAlerts,
} from './metrics.js';
import { buildLiveView } from './liveStatus.js';
import { isWithinWorkingHours } from './schedule.js';

/** Читает файл или '' (best-effort). */
async function readOptional(filePath) {
  return readFile(filePath, 'utf8').catch(() => '');
}

/**
 * Список аккаунтов из config/accounts/ (имена директорий) для блока «Управление».
 * Best-effort — никогда не бросает. Исключает шаблон 'example', служебный 'default'
 * (не настоящий аккаунт — без резюме/сессии, задачи по нему падают) и скрытые папки.
 * Имена аккаунтов — операторские метки (не ключ/PII; те же имена уже видны в
 * /api/metrics byAccount), отдавать их в локальную панель безопасно.
 *
 * @param {{ readdirFn?: Function, dir?: string }} [deps] — инъекция для тестов.
 * @returns {Promise<string[]>} отсортированный список имён аккаунтов.
 */
export async function listAccounts(deps = {}) {
  const readdirFn = typeof deps.readdirFn === 'function' ? deps.readdirFn : readdir;
  const dir = typeof deps.dir === 'string' && deps.dir ? deps.dir : accountsConfigDir;
  let entries = [];
  try {
    entries = await readdirFn(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e) => e && typeof e.isDirectory === 'function' && e.isDirectory())
    .map((e) => e.name)
    .filter((name) => typeof name === 'string' && name && name !== 'example' && name !== 'default' && !name.startsWith('.'))
    .sort();
}

/**
 * Собирает метрики из logs/. Никогда не бросает (битые файлы пропускаются).
 * @returns {Promise<object>}
 */
export async function collectMetrics() {
  let files = [];
  try {
    files = await readdir(logsDir);
  } catch {
    files = [];
  }

  // responses-*.jsonl (включая responses-log.jsonl) — все аккаунты в одну кучу.
  const responseFiles = files.filter((f) => /^responses.*\.jsonl$/.test(f));
  let responseEntries = [];
  for (const f of responseFiles) {
    const text = await readOptional(path.join(logsDir, f));
    responseEntries = responseEntries.concat(parseJsonl(text));
  }

  // summary-*.json + summary.json
  const summaryFiles = files.filter((f) => /^summary.*\.json$/.test(f));
  const summaries = [];
  for (const f of summaryFiles) {
    const text = await readOptional(path.join(logsDir, f));
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj === 'object') summaries.push(obj);
    } catch {
      // битый файл — пропускаем
    }
  }

  // daily-*.json
  const dailyFiles = files.filter((f) => /^daily-.*\.json$/.test(f));
  const dailies = [];
  for (const f of dailyFiles) {
    const text = await readOptional(path.join(logsDir, f));
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj === 'object') dailies.push(obj);
    } catch {
      // битый файл — пропускаем
    }
  }

  // alerts.jsonl (append-only) — дневные алерты демона. Только счётчики/строки, без PII.
  const alertsText = await readOptional(path.join(logsDir, 'alerts.jsonl'));
  const alerts = aggregateAlerts(parseJsonl(alertsText));

  const responses = aggregateResponses(responseEntries);
  const summary = aggregateSummaries(summaries);
  const daily = aggregateDaily(dailies);

  // Токены/стоимость: предпочитаем дневные отчёты (там разбивка по дням), но если в них
  // токенов нет (демон ещё не дошил их в daily) — берём реальные из summary.tokensRunCumulative.
  const dailyTokens = dailies.reduce(
    (acc, d) => {
      acc.promptTokens += Number(d?.tokens?.promptTokens) || 0;
      acc.completionTokens += Number(d?.tokens?.completionTokens) || 0;
      acc.cacheHitTokens += Number(d?.tokens?.cacheHitTokens) || 0;
      return acc;
    },
    { promptTokens: 0, completionTokens: 0, cacheHitTokens: 0 },
  );
  const hasDailyTokens = dailyTokens.promptTokens > 0 || dailyTokens.completionTokens > 0;
  const tokenTotals = hasDailyTokens
    ? dailyTokens
    : {
        promptTokens: summary.totals.promptTokens,
        completionTokens: summary.totals.completionTokens,
        cacheHitTokens: summary.totals.cacheHitTokens,
      };
  const tokenSource = hasDailyTokens ? 'daily' : 'summary';
  const estCostUsd = estimateCost(tokenTotals);

  // Воронка: отклики (из responses) + сообщения (сумма по daily).
  const messagesProcessed = daily.reduce((s, d) => s + d.messagesProcessed, 0);
  const replied = daily.reduce((s, d) => s + d.replied, 0);
  const funnel = computeFunnel({ applied: responses.applied, messagesProcessed, replied });

  return {
    generatedAt: new Date().toISOString(),
    responses,
    summary,
    daily,
    tokenTotals,
    tokenSource,
    estCostUsd,
    funnel,
    alerts,
  };
}

/**
 * Собирает «живой» снимок для блока «Сейчас» (M11.11): хартбиты аккаунтов
 * (logs/status/<account>.json), последние замеры ресурсов (logs/resources.jsonl) и последние
 * события по аккаунту (responses-<account>.jsonl, только {status, at} — без title/url/PII).
 * Никогда не бросает (битые/отсутствующие файлы пропускаются).
 * @returns {Promise<object>}
 */
export async function collectLive() {
  // Хартбиты аккаунтов из logs/status/*.json.
  let statusFiles = [];
  try {
    statusFiles = await readdir(statusDir);
  } catch {
    statusFiles = [];
  }
  const heartbeats = [];
  for (const f of statusFiles.filter((x) => /\.json$/.test(x))) {
    const text = await readOptional(path.join(statusDir, f));
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj === 'object') heartbeats.push(obj);
    } catch {
      // битый файл статуса — пропускаем
    }
  }

  // Замеры ресурсов (общие по процессу демона).
  const resources = parseJsonl(await readOptional(path.join(logsDir, 'resources.jsonl')));

  // Аккаунты из config + последние события из responses-<account>.jsonl (санитизация в liveStatus).
  const accounts = await listAccounts();
  const eventsByAccount = {};
  for (const account of accounts) {
    // Канонический путь лога аккаунта (та же нормализация, что у живого флоу).
    const entries = parseJsonl(await readOptional(getAccountLogPath(account)));
    // UI показывает последние N событий — отдаём хвост (как collectMetrics, читаем файл целиком).
    eventsByAccount[account] = entries.slice(-50);
  }

  const now = new Date();
  return buildLiveView({
    accounts,
    heartbeats,
    resources,
    eventsByAccount,
    now,
    withinWorkingHours: isWithinWorkingHours(now),
  });
}

/**
 * Собирает mtime файлов, за которыми следит live-стрим панели (M13.3, было — SSE в
 * dashboard.js, теперь — периодический IPC-пуш из electron-main.js): хартбиты
 * logs/status/*.json + замеры logs/resources.jsonl. Отсутствующие/нечитаемые файлы
 * пропускаются (их исчезновение/появление само меняет сигнатуру). Никогда не бросает.
 *
 * @returns {Promise<Array<{name: string, mtimeMs: number}>>}
 */
export async function collectStreamMtimes() {
  const entries = [];
  let statusFiles = [];
  try {
    statusFiles = await readdir(statusDir);
  } catch {
    statusFiles = [];
  }
  for (const f of statusFiles.filter((x) => /\.json$/.test(x))) {
    try {
      const st = await stat(path.join(statusDir, f));
      entries.push({ name: `status/${f}`, mtimeMs: st.mtimeMs });
    } catch {
      // файл исчез между readdir и stat — пропускаем
    }
  }
  try {
    const st = await stat(resourcesLogPath);
    entries.push({ name: 'resources.jsonl', mtimeMs: st.mtimeMs });
  } catch {
    // нет файла ресурсов (демон не запущен) — пропускаем
  }
  return entries;
}
