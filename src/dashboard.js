/**
 * src/dashboard.js — лёгкая локальная админ-панель hh-auto-otkliki.
 *
 * Зачем: следить за откликами, конверсией, токенами/стоимостью, сообщениями и резюме.
 * Чем: только Node-builtins (http/fs) + Chart.js по CDN в браузере. Без сборки и новых
 * зависимостей — легко поднять на сервере.
 *
 * Безопасность:
 *   - Слушает ТОЛЬКО 127.0.0.1 (localhost) — наружу не торчит.
 *   - В выдачу идут ЧИСЛА и статусы; заголовки/URL вакансий и любой PII НЕ отдаются
 *     (агрегаторы в lib/metrics.js считают только счётчики).
 *
 * Запуск:
 *   node src/dashboard.js [--port 8787]
 *   затем открыть http://127.0.0.1:8787
 */

import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { logsDir, statusDir, resourcesLogPath, accountsConfigDir, getAccountLogPath } from './config.js';
import {
  parseJsonl,
  aggregateResponses,
  aggregateSummaries,
  aggregateDaily,
  estimateCost,
  computeFunnel,
  aggregateAlerts,
} from './lib/metrics.js';
import { createTaskRunner } from './lib/taskRunner.js';
import { buildLiveView } from './lib/liveStatus.js';
import { isWithinWorkingHours } from './lib/schedule.js';
import { buildMtimeSignature, signatureChanged } from './lib/streamWatcher.js';

const DEFAULT_PORT = 8787;

// Период опроса mtime файлов статуса/ресурсов для SSE-стрима «Сейчас» (M13.3).
const STREAM_POLL_MS = 400;

// Максимальный размер тела POST-запроса (управление). Сервер слушает только loopback,
// но всё равно ограничиваем — защита от случайного раздувания.
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Читает тело запроса и парсит JSON. Бросает на превышении лимита/битом JSON.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<object>}
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let aborted = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        reject(new Error('Тело запроса слишком большое'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        const obj = JSON.parse(raw);
        resolve(obj && typeof obj === 'object' ? obj : {});
      } catch {
        reject(new Error('Некорректный JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Отправляет JSON-ответ с кодом status. */
function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/** Извлекает hostname из заголовка Host (срезает порт, разворачивает IPv6 [::1]). */
function hostnameOf(hostHeader) {
  const h = String(hostHeader == null ? '' : hostHeader).trim().toLowerCase();
  if (!h) return '';
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']')); // [::1]:port → ::1
  return h.split(':')[0];
}

/** true, если hostname — петлевой (loopback). */
function isLoopbackHostname(name) {
  return name === '127.0.0.1' || name === 'localhost' || name === '::1';
}

/**
 * Защита управляющих эндпоинтов от DNS-rebinding и cross-origin POST: сервер слушает
 * только 127.0.0.1, но локальная веб-страница в браузере оператора всё равно может
 * выстрелить fetch на 127.0.0.1 и запустить live-задачу. Поэтому требуем, чтобы Host был
 * петлевым И (если заголовок Origin присутствует) был тоже петлевым/же-origin.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
export function isLoopbackRequest(req) {
  const headers = (req && req.headers) || {};
  if (!isLoopbackHostname(hostnameOf(headers.host))) return false;

  const origin = headers.origin;
  // Нет Origin (не-браузерный клиент / same-origin navigation) — допускаем.
  if (origin == null || origin === '') return true;
  try {
    return isLoopbackHostname(hostnameOf(new URL(origin).host));
  } catch {
    return false; // непарсимый Origin — отклоняем
  }
}

/** Парсит --port из argv (по умолчанию 8787). */
export function parsePort(argv) {
  const arr = Array.isArray(argv) ? argv : [];
  const i = arr.indexOf('--port');
  if (i >= 0) {
    const n = Number(arr[i + 1]);
    if (Number.isFinite(n) && n > 0 && n < 65536) return n;
  }
  const env = Number(process.env.DASHBOARD_PORT);
  if (Number.isFinite(env) && env > 0 && env < 65536) return env;
  return DEFAULT_PORT;
}

/** Читает файл или '' (best-effort). */
async function readOptional(filePath) {
  return readFile(filePath, 'utf8').catch(() => '');
}

/**
 * Список аккаунтов из config/accounts/ (имена директорий) для блока «Управление».
 * Best-effort — никогда не бросает. Исключает шаблон 'example' и скрытые папки.
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
    .filter((name) => typeof name === 'string' && name && name !== 'example' && !name.startsWith('.'))
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
 * Собирает mtime файлов, за которыми следит SSE-стрим (M13.3): хартбиты
 * logs/status/*.json + замеры logs/resources.jsonl. Отсутствующие/нечитаемые файлы
 * пропускаются (их исчезновение/появление само меняет сигнатуру). Никогда не бросает.
 *
 * @returns {Promise<Array<{name: string, mtimeMs: number}>>}
 */
async function collectStreamMtimes() {
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

/**
 * Обслуживает SSE-стрим GET /api/stream (M13.3): держит соединение, каждые ~400 мс
 * сверяет mtime статус/ресурс-файлов и при изменении пушит свежий снимок «Сейчас»
 * (тот же, что отдаёт /api/live). Только числа/статусы — без PII (санитизация в liveStatus).
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
function handleStream(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });

  let closed = false;
  let busy = false;
  let lastSig = null;

  const tick = async (force) => {
    if (closed || busy) return; // не наслаиваем тики, если чтение/collectLive затянулось
    busy = true;
    try {
      const sig = buildMtimeSignature(await collectStreamMtimes());
      if (force || signatureChanged(lastSig, sig)) {
        lastSig = sig;
        const data = await collectLive();
        if (!closed) res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    } catch {
      // best-effort — сбой чтения не роняет стрим (следующий тик повторит)
    } finally {
      busy = false;
    }
  };

  // Первый снимок — сразу после подключения.
  tick(true);
  const timer = setInterval(() => tick(false), STREAM_POLL_MS);
  if (typeof timer.unref === 'function') timer.unref(); // не держим event loop

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

// HTML страницы (Chart.js по CDN). Данные тянутся с /api/metrics.
const PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>hh-auto-otkliki — панель</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 24px; background: #0f1115; color: #e6e6e6; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #8a8f98; font-size: 13px; margin-bottom: 20px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: #171a21; border: 1px solid #242832; border-radius: 10px; padding: 14px 16px; }
  .card .v { font-size: 26px; font-weight: 600; }
  .card .l { color: #8a8f98; font-size: 12px; margin-top: 4px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
  .panel { background: #171a21; border: 1px solid #242832; border-radius: 10px; padding: 16px; }
  .panel h2 { font-size: 14px; margin: 0 0 12px; color: #c8ccd4; font-weight: 600; }
  .err { color: #ff6b6b; }
  .muted { color: #8a8f98; font-size: 13px; }
  .alert { display: flex; gap: 10px; align-items: baseline; padding: 7px 0; border-bottom: 1px solid #242832; font-size: 13px; }
  .alert .lvl { font-weight: 700; font-size: 11px; padding: 2px 6px; border-radius: 5px; }
  .alert.crit .lvl { background: #5a1f1f; color: #ff9b9b; }
  .alert.warn .lvl { background: #5a4a1f; color: #ffd47a; }
  .alert .msg { flex: 1; color: #c8ccd4; }
  .alert .when { color: #8a8f98; white-space: nowrap; }
  button { background: #242832; color: #e6e6e6; border: 1px solid #333; border-radius: 8px; padding: 6px 12px; cursor: pointer; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  .ctl-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #242832; flex-wrap: wrap; }
  .ctl-row:last-child { border-bottom: none; }
  .ctl-acc { font-weight: 600; min-width: 120px; }
  .ctl-btns { display: flex; gap: 6px; }
  .ctl-stop { border-color: #5a1f1f; }
  .ctl-status { margin-left: auto; font-size: 12px; }
  .st-run { color: #7bd88f; }
  .st-stop { color: #ffb454; }
  .st-idle { color: #8a8f98; }
  .live-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: middle; }
  .lv-working { background: #7bd88f; }
  .lv-stalled { background: #ff6b6b; }
  .lv-captcha { background: #ffb454; }
  .lv-limit { background: #ffb454; }
  .lv-idle { background: #8a8f98; }
  .live-row { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px solid #242832; flex-wrap: wrap; }
  .live-row:last-child { border-bottom: none; }
  .live-acc { font-weight: 600; min-width: 120px; display: flex; align-items: center; gap: 8px; }
  .live-task { font-size: 13px; color: #c8ccd4; min-width: 150px; }
  .live-bar { flex: 1; min-width: 120px; height: 8px; background: #242832; border-radius: 5px; overflow: hidden; }
  .live-bar > i { display: block; height: 100%; background: #4cafef; }
  .live-meta { font-size: 12px; color: #8a8f98; }
  .live-events { font-size: 11px; color: #8a8f98; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
  .live-counts { flex-basis: 100%; font-size: 12px; color: #c8ccd4; }
  .live-chart-wrap { flex-basis: 100%; display: flex; align-items: center; gap: 10px; margin-top: 4px; }
  .live-chart-wrap canvas { flex-shrink: 0; }
  details.history { margin-top: 8px; border: 1px solid #242832; border-radius: 10px; background: #14161c; }
  details.history > summary { cursor: pointer; padding: 12px 16px; font-size: 14px; font-weight: 600; color: #c8ccd4; user-select: none; list-style: none; }
  details.history > summary::-webkit-details-marker { display: none; }
  details.history > summary::before { content: '▸ '; color: #8a8f98; }
  details.history[open] > summary::before { content: '▾ '; }
  details.history > .history-body { padding: 0 16px 16px; }
</style>
</head>
<body>
  <h1>hh-auto-otkliki — панель управления</h1>
  <div class="sub">Локально (127.0.0.1). Фокус — текущий прогон: что программа делает сейчас. Агрегаты за всю историю — в блоке «История» ниже.</div>
  <div class="panel" style="margin-bottom: 24px">
    <h2>Управление задачами</h2>
    <div class="sub" style="margin-bottom: 12px">По аккаунту: Отклики / Сообщения / Резюме — каждая запускается и останавливается <b>независимо</b>. «Старт» = <b>реальный (LIVE) прогон</b> на hh.ru; перед запуском — одно подтверждение.</div>
    <div class="ctl-search" style="margin-bottom: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
      <span class="sub">Поиск для «Отклики»:</span>
      <input id="srch-text" type="text" placeholder="text (напр. DevOps)" value="DevOps" style="flex: 1; min-width: 160px">
      <input id="srch-area" type="text" placeholder="area" value="1" title="регион hh.ru (1 = Москва)" style="width: 70px">
      <input id="srch-limit" type="number" min="1" placeholder="limit" value="200" title="число откликов" style="width: 90px">
    </div>
    <div id="controlBody" class="muted">Загрузка…</div>
  </div>
  <div class="panel" style="margin-bottom: 24px">
    <h2>Сейчас</h2>
    <div class="sub" style="margin-bottom: 12px">Живое состояние прогонов: текущая задача/шаг/прогресс, индикатор живости (<span class="live-dot lv-working"></span> работает · <span class="live-dot lv-stalled"></span> завис · <span class="live-dot lv-captcha"></span> капча · <span class="live-dot lv-limit"></span> лимит откликов · <span class="live-dot lv-idle"></span> простой), ресурсы и токены/стоимость за сегодня. Живое обновление (SSE, &lt; 0,5 с).</div>
    <div id="liveRes" class="muted" style="margin-bottom: 10px"></div>
    <div id="liveBody" class="muted">Загрузка…</div>
  </div>
  <details class="history" id="historyBlock">
    <summary>История за всё время (агрегаты, графики)</summary>
    <div class="history-body">
      <div class="sub">Накопительная статистика за всю историю логов. <span id="gen"></span> <button onclick="load()">Обновить</button></div>
      <div class="cards" id="cards"></div>
      <div class="grid">
        <div class="panel"><h2>Отклики по дням</h2><canvas id="byDay"></canvas></div>
        <div class="panel"><h2>Отклики по статусу</h2><canvas id="byStatus"></canvas></div>
        <div class="panel"><h2>Отклики по аккаунтам</h2><canvas id="byAccount"></canvas></div>
        <div class="panel"><h2>Воронка конверсии</h2><canvas id="funnel"></canvas></div>
        <div class="panel"><h2>Скоринг (локально / модель / кэш)</h2><canvas id="scoring"></canvas></div>
        <div class="panel"><h2>Сообщения по дням</h2><canvas id="messages"></canvas></div>
        <div class="panel" style="grid-column: 1 / -1"><h2>Алерты демона (последние)</h2><div id="alertsList"></div></div>
      </div>
    </div>
  </details>
<script>
const charts = {};
function chart(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart(document.getElementById(id), cfg); }
function card(v, l) { return '<div class="card"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function renderAlerts(a) {
  const el = document.getElementById('alertsList');
  if (!a || !a.recent || !a.recent.length) { el.innerHTML = '<div class="muted">Алертов нет — всё спокойно.</div>'; return; }
  el.innerHTML = a.recent.map(x => {
    const when = x.at ? new Date(x.at).toLocaleString('ru') : '—';
    return '<div class="alert ' + (x.level === 'critical' ? 'crit' : 'warn') + '">' +
      '<span class="lvl">' + (x.level === 'critical' ? 'CRIT' : 'WARN') + '</span> ' +
      '<span class="msg">' + esc(x.message) + '</span> ' +
      '<span class="when">' + esc(when) + '</span></div>';
  }).join('');
}
let lastMetrics = null; // снимок /api/metrics для блока «Сейчас» (токены/стоимость).
async function load() {
  // Метрики тянем всегда (нужны блоку «Сейчас» для токенов/стоимости), но тяжёлые
  // карточки/графики истории рисуем только когда блок «История» раскрыт: Chart.js в
  // свёрнутом <details> рендерится с нулевым размером.
  let m;
  try { m = await (await fetch('/api/metrics')).json(); }
  catch (e) { lastMetrics = null; const c = document.getElementById('cards'); if (c) c.innerHTML = '<div class="card err">Ошибка загрузки</div>'; return; }
  lastMetrics = m;
  const hist = document.getElementById('historyBlock');
  if (hist && hist.open) renderHistory();
}

function renderHistory() {
  const m = lastMetrics;
  if (!m) return;
  document.getElementById('gen').textContent = 'обновлено ' + new Date(m.generatedAt).toLocaleString('ru');

  const conv = m.funnel.conversionPct.toFixed(1) + '%';
  const cachePct = (m.summary.cacheHitRatio * 100).toFixed(0) + '%';
  const tokCachePct = (m.summary.tokenCacheHitRatio * 100).toFixed(0) + '%';
  document.getElementById('cards').innerHTML =
    card(m.responses.applied, 'Откликов отправлено') +
    card(conv, 'Конверсия (вовлечённые/отклики)') +
    card(m.funnel.stages[2].value, 'Ответов в чате') +
    card(cachePct, 'Кэш-хит скоринга (локальный)') +
    card(tokCachePct, 'Context-cache DeepSeek (токены)') +
    card('$' + m.estCostUsd.toFixed(2), 'Оценка стоимости DeepSeek') +
    card((m.responses.byStatus.error || 0), 'Ошибок') +
    card((m.alerts.byLevel.critical || 0) + ' / ' + (m.alerts.byLevel.warn || 0), 'Алерты (critical / warn)');

  renderAlerts(m.alerts);

  const d = m.responses.daily;
  chart('byDay', { type: 'line', data: { labels: d.map(x => x.day), datasets: [
    { label: 'Отправлено', data: d.map(x => x.applied), borderColor: '#4cafef', tension: .3 },
    { label: 'Всего осмотрено', data: d.map(x => x.total), borderColor: '#8a8f98', tension: .3 },
  ] }, options: { plugins: { legend: { labels: { color: '#c8ccd4' } } }, scales: scaleOpts() } });

  const st = m.responses.byStatus;
  chart('byStatus', { type: 'doughnut', data: { labels: Object.keys(st), datasets: [{ data: Object.values(st),
    backgroundColor: ['#4cafef','#7bd88f','#ffb454','#ff6b6b','#b48ead','#8a8f98','#56b6c2'] } ] },
    options: { plugins: { legend: { labels: { color: '#c8ccd4' } } } } });

  const acc = m.responses.byAccount; const accNames = Object.keys(acc);
  chart('byAccount', { type: 'bar', data: { labels: accNames, datasets: [
    { label: 'Отправлено', data: accNames.map(a => acc[a].applied), backgroundColor: '#4cafef' },
    { label: 'Ошибки', data: accNames.map(a => acc[a].errors), backgroundColor: '#ff6b6b' },
  ] }, options: { plugins: { legend: { labels: { color: '#c8ccd4' } } }, scales: scaleOpts() } });

  chart('funnel', { type: 'bar', data: { labels: m.funnel.stages.map(s => s.label), datasets: [
    { label: 'Кол-во', data: m.funnel.stages.map(s => s.value), backgroundColor: ['#4cafef','#ffb454','#7bd88f'] },
  ] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: scaleOpts() } });

  const t = m.summary.totals;
  chart('scoring', { type: 'doughnut', data: { labels: ['Локально (0 ток.)','Модель','Кэш (0 ток.)'], datasets: [
    { data: [t.locallyScored, t.modelScored, t.cachedScored], backgroundColor: ['#7bd88f','#ffb454','#4cafef'] },
  ] }, options: { plugins: { legend: { labels: { color: '#c8ccd4' } } } } });

  chart('messages', { type: 'bar', data: { labels: m.daily.map(x => x.date), datasets: [
    { label: 'Осмотрено', data: m.daily.map(x => x.messagesProcessed), backgroundColor: '#8a8f98' },
    { label: 'Ответов', data: m.daily.map(x => x.replied), backgroundColor: '#7bd88f' },
  ] }, options: { plugins: { legend: { labels: { color: '#c8ccd4' } } }, scales: scaleOpts() } });
}
function scaleOpts() { return { x: { ticks: { color: '#8a8f98' }, grid: { color: '#242832' } }, y: { ticks: { color: '#8a8f98' }, grid: { color: '#242832' } } }; }

// --- Блок «Управление» (M11.10, обновлён M12.7): запуск/стоп задач независимо по аккаунту ---
const TASK_LABELS = { apply: 'Отклики', messages: 'Сообщения', resume: 'Резюме' };
const TASKS = ['apply', 'messages', 'resume'];
let controlAccounts = [];
// Ключ: acc+'\0'+task → true (показать «остановлено» до следующего обновления).
const controlStopped = {};

async function loadControl() {
  let accRes, taskRes;
  try {
    [accRes, taskRes] = await Promise.all([
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/tasks').then(r => r.json()),
    ]);
  } catch (e) {
    document.getElementById('controlBody').innerHTML = '<div class="err">Ошибка загрузки управления</div>';
    return;
  }
  controlAccounts = (accRes && accRes.accounts) || [];
  const tasks = (taskRes && taskRes.tasks) || [];
  // Индекс по паре account+task — каждая задача независима (M12.7).
  const byAccTask = {};
  for (const t of tasks) if (t && t.account && t.task) byAccTask[t.account + '\0' + t.task] = t;

  const el = document.getElementById('controlBody');
  if (!controlAccounts.length) {
    el.innerHTML = '<div class="muted">Аккаунтов не найдено (config/accounts/).</div>';
    return;
  }
  // Per-account блок с per-task строками: каждая задача имеет свои Старт/Стоп (M12.7).
  el.innerHTML = controlAccounts.map((acc, i) =>
    '<div style="margin-bottom: 14px; border: 1px solid #242832; border-radius: 8px; padding: 10px 12px">' +
    '<div class="ctl-acc" style="margin-bottom: 8px">' + esc(acc) + '</div>' +
    TASKS.map(tk => {
      const key = acc + '\0' + tk;
      const run = byAccTask[key];
      const running = !!run;
      let statusTxt, statusCls;
      if (running) {
        statusTxt = 'LIVE' + (run.pid != null ? ' · pid ' + esc(run.pid) : '');
        statusCls = 'st-run';
      } else if (controlStopped[key]) {
        statusTxt = 'остановлено'; statusCls = 'st-stop';
      } else {
        statusTxt = 'простаивает'; statusCls = 'st-idle';
      }
      return '<div class="ctl-row">' +
        '<div style="min-width: 90px; font-size: 13px">' + TASK_LABELS[tk] + '</div>' +
        '<button data-action="start" data-idx="' + i + '" data-task="' + tk + '"' +
          (running ? ' disabled' : '') + '>Старт</button>' +
        '<button class="ctl-stop" data-action="stop" data-idx="' + i + '" data-task="' + tk + '"' +
          (running ? '' : ' disabled') + '>Стоп</button>' +
        '<div class="ctl-status ' + statusCls + '">' + statusTxt + '</div>' +
        '</div>';
    }).join('') +
    '</div>'
  ).join('');

  el.querySelectorAll('button[data-action="start"]').forEach(b =>
    b.addEventListener('click', () => startTask(+b.dataset.idx, b.dataset.task)));
  el.querySelectorAll('button[data-action="stop"]').forEach(b =>
    b.addEventListener('click', () => stopTask(+b.dataset.idx, b.dataset.task)));
}

async function startTask(i, task) {
  const acc = controlAccounts[i];
  if (!acc) return;
  if (!confirm('Запустить РЕАЛЬНЫЙ прогон «' + (TASK_LABELS[task] || task) + '» для «' + acc + '»?\\n' +
      'Это реальные отклики/ответы на hh.ru.')) return;
  delete controlStopped[acc + '\0' + task];
  const payload = { task, account: acc, live: true };
  if (task === 'apply') {
    const t = (document.getElementById('srch-text').value || '').trim();
    const a = (document.getElementById('srch-area').value || '').trim();
    const l = Number(document.getElementById('srch-limit').value);
    if (t) payload.text = t;
    if (a) payload.area = a;
    if (Number.isFinite(l) && l > 0) payload.limit = l;
  }
  try {
    const res = await fetch('/api/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) alert('Не удалось запустить: ' + (json.reason || res.status));
  } catch (e) {
    alert('Ошибка запуска');
  }
  loadControl();
}

async function stopTask(i, task) {
  const acc = controlAccounts[i];
  if (!acc) return;
  try {
    const res = await fetch('/api/stop', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: acc, task }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) controlStopped[acc + '\0' + task] = true;
    else alert('Не удалось остановить: ' + (json.reason || res.status));
  } catch (e) {
    alert('Ошибка остановки');
  }
  loadControl();
}

// --- Блок «Сейчас» (M11.11, обновлён M12.8): живое состояние — одна строка на (аккаунт, задачу) ---
const LIVENESS_LABEL = { working: 'работает', stalled: 'завис', captcha: 'капча', limit: 'лимит откликов', idle: 'простой' };
const LIVE_TASK_LABEL = { apply: 'Отклики', messages: 'Сообщения', resume: 'Резюме' };
// Реестр Chart-инстансов мини-графиков текущего прогона (M17.4).
// Ключ: account + '__' + task. Инстансы уничтожаются перед пересборкой DOM,
// чтобы не натекать при каждом тике SSE.
const liveCharts = {};

function fmtAge(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' с назад';
  const m = Math.round(s / 60);
  return m + ' мин назад';
}

async function loadLive() {
  let v;
  try { v = await (await fetch('/api/live')).json(); }
  catch (e) { document.getElementById('liveBody').innerHTML = '<div class="err">Ошибка загрузки</div>'; return; }
  renderLive(v);
}

function renderLive(v) {
  if (!v) return;
  // Ресурсы + токены/стоимость за сегодня (из последнего снимка метрик).
  const r = v.resources && v.resources.latest;
  const resTxt = r
    ? 'RSS ' + esc(r.rssMb) + ' МБ · heap ' + esc(r.heapMb) + ' МБ · CPU ' + esc(r.cpuPercent) + '%' +
      (r.openContexts != null ? ' · контекстов ' + esc(r.openContexts) : '')
    : 'нет замеров ресурсов (демон не запущен)';
  let tokTxt = '';
  if (lastMetrics) {
    const t = lastMetrics.tokenTotals || {};
    const promptTok = (t.promptTokens || 0), completionTok = (t.completionTokens || 0);
    tokTxt = ' · токены: вход ' + esc(promptTok) + ' / выход ' + esc(completionTok) +
      ' · ≈$' + Number(lastMetrics.estCostUsd || 0).toFixed(2);
  }
  document.getElementById('liveRes').innerHTML = esc(resTxt) + tokTxt;

  const el = document.getElementById('liveBody');
  if (!v.accounts || !v.accounts.length) {
    // Уничтожаем старые мини-графики перед очисткой DOM (M17.4).
    for (const key of Object.keys(liveCharts)) { liveCharts[key].destroy(); delete liveCharts[key]; }
    el.innerHTML = '<div class="muted">Нет аккаунтов / активных прогонов.</div>';
    return;
  }

  // Уничтожаем старые мини-графики перед пересборкой DOM (M17.4).
  // innerHTML= удаляет canvas-узлы, на которых они держались — без destroy() натечёт память.
  for (const key of Object.keys(liveCharts)) { liveCharts[key].destroy(); delete liveCharts[key]; }

  // buildLiveView теперь возвращает одну запись на (account, task) — группируем по аккаунту (M12.8).
  el.innerHTML = v.accounts.map(a => {
    const live = a.liveness || 'idle';
    const taskTxt = a.task ? (LIVE_TASK_LABEL[a.task] || esc(a.task)) : '';
    const phaseTxt = a.phaseLabel ? ' · ' + esc(a.phaseLabel) : '';
    const pct = a.progressPct != null ? a.progressPct : 0;
    const events = (a.recentEvents || []).map(e => esc(e.status)).join(', ');
    const livCls = live === 'working' ? 'run' : live === 'idle' ? 'idle' : 'stop';
    const c = a.counts;
    const countsTxt = c
      ? 'отпр. ' + esc(c.sent) + ' · пропущ. ' + esc(c.skipped) + ' · уже ' + esc(c.alreadyApplied) +
        ' · ручн. ' + esc(c.manual) + ' · ошиб. ' + esc(c.errors) + ' · просм. ' + esc(c.viewed) +
        ' · токены ' + esc((c.tokens && c.tokens.totalTokens) || 0) +
        ' (вызовов ' + esc((c.tokens && c.tokens.calls) || 0) +
        ', ≈$' + Number((c.tokens && c.tokens.estimatedCostUsd) || 0).toFixed(2) + ')'
      : '';
    // Мини-график текущего прогона (M17.4): дограф только при наличии counts.
    // canvas-id кодируем как «lc-» + безопасный ключ (account__task без спецсимволов).
    const chartKey = esc(a.account) + '__' + esc(a.task || 'idle');
    const canvasId = 'lc-' + chartKey.replace(/[^A-Za-z0-9_-]/g, '_');
    const showChart = !!(c && (c.sent || c.skipped || c.alreadyApplied || c.errors));
    const chartHtml = showChart
      ? '<div class="live-chart-wrap"><canvas id="' + canvasId + '" width="80" height="80"></canvas>' +
        '<span class="muted" style="font-size:11px">отпр.&nbsp;<b style="color:#7bd88f">' + esc(c.sent) + '</b>' +
        '&nbsp;· пропущ.&nbsp;<b style="color:#8a8f98">' + esc(c.skipped) + '</b>' +
        '&nbsp;· уже&nbsp;<b style="color:#4cafef">' + esc(c.alreadyApplied) + '</b>' +
        '&nbsp;· ошиб.&nbsp;<b style="color:#ff6b6b">' + esc(c.errors) + '</b></span></div>'
      : '';
    return '<div class="live-row" data-chart-key="' + chartKey + '" data-canvas-id="' + canvasId + '">' +
      '<div class="live-acc"><span class="live-dot lv-' + esc(live) + '"></span>' + esc(a.account) + '</div>' +
      '<div class="live-task">' + (taskTxt || '<span class="muted">простаивает</span>') +
        phaseTxt + (taskTxt ? ' <span class="st-' + livCls + '">(' + (LIVENESS_LABEL[live] || live) + ')</span>' : '') + '</div>' +
      '<div class="live-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="live-meta">' + fmtAge(a.ageMs) + '</div>' +
      '<div class="live-events">' + (events || '—') + '</div>' +
      (countsTxt ? '<div class="live-counts">' + countsTxt + '</div>' : '') +
      chartHtml +
      '</div>';
  }).join('');

  // Создаём мини-графики после вставки DOM (M17.4). Один дограф на активный ряд.
  // destroy() уже вызван выше — здесь всегда создаём новый Chart (нет утечки).
  for (const a of v.accounts) {
    const c = a.counts;
    if (!c || !(c.sent || c.skipped || c.alreadyApplied || c.errors)) continue;
    const chartKey = esc(a.account) + '__' + esc(a.task || 'idle');
    const canvasId = 'lc-' + chartKey.replace(/[^A-Za-z0-9_-]/g, '_');
    const canvas = document.getElementById(canvasId);
    if (!canvas) continue;
    liveCharts[chartKey] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Отправлено', 'Пропущено', 'Уже отклик.', 'Ошибки'],
        datasets: [{
          data: [c.sent, c.skipped, c.alreadyApplied, c.errors],
          backgroundColor: ['#7bd88f', '#8a8f98', '#4cafef', '#ff6b6b'],
          borderWidth: 0,
        }],
      },
      options: {
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ctx.label + ': ' + ctx.parsed } },
        },
        cutout: '60%',
      },
    });
  }
}

// Живое обновление блока «Сейчас» через SSE (M13.3): сервер пушит снимок при
// изменении файлов статуса/ресурсов (задержка < 500 мс). Если EventSource недоступен
// или соединение окончательно закрылось — откат на polling каждые 2 с.
function startLiveStream() {
  let polling = false;
  function fallbackToPolling() {
    if (polling) return;
    polling = true;
    loadLive();
    setInterval(loadLive, 2000);
  }
  if (typeof EventSource === 'undefined') { fallbackToPolling(); return; }
  let es;
  try { es = new EventSource('/api/stream'); }
  catch (e) { fallbackToPolling(); return; }
  es.onmessage = (ev) => {
    try { renderLive(JSON.parse(ev.data)); } catch (e) { /* битый фрейм — ждём следующий */ }
  };
  es.onerror = () => {
    // CLOSED (readyState 2) — соединение не восстановится: уходим в polling.
    // CONNECTING — EventSource сам переподключится, ничего не делаем.
    if (es.readyState === 2) fallbackToPolling();
  };
}

// Раскрытие «Истории» — дорисовать графики из уже загруженного снимка (или дотянуть).
const historyBlock = document.getElementById('historyBlock');
if (historyBlock) historyBlock.addEventListener('toggle', () => {
  if (historyBlock.open) { if (lastMetrics) renderHistory(); else load(); }
});

load();
loadControl();
setInterval(loadControl, 1000);
startLiveStream();
</script>
</body>
</html>`;

/**
 * Создаёт http-сервер (не слушает — для тестов).
 *
 * @param {{ runner?: object }} [deps] — реестр задач (инъекция для тестов).
 *   По умолчанию каждый сервер получает свой createTaskRunner().
 * @returns {import('node:http').Server}
 */
export function createServer(deps = {}) {
  // Свой реестр на сервер: одна задача на аккаунт, трекинг PID (M11.8).
  // Аудит-лог запусков/остановок (M11.9): пишем в stdout через console.log
  // (конвенция проекта). Строка содержит только task/account/live/pid — без ключа/PII/писем.
  const runner = deps.runner || createTaskRunner({ log: (msg) => console.log(msg) });

  return http.createServer(async (req, res) => {
    try {
      // --- Управление задачами (start/stop/tasks) ---
      // Защита: эти эндпоинты ЗАПУСКАЮТ действия наружу → пускаем только петлевые запросы
      // (защита от cross-origin POST из браузера оператора и DNS-rebinding).
      const isControl =
        req.url === '/api/start' ||
        req.url === '/api/stop' ||
        req.url === '/api/tasks' ||
        req.url === '/api/accounts';
      if (isControl && !isLoopbackRequest(req)) {
        sendJson(res, 403, { ok: false, error: 'Запрос отклонён: разрешён только localhost' });
        return;
      }

      // --- Управление задачами (POST) ---
      if (req.method === 'POST' && req.url === '/api/start') {
        let body;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err.message });
          return;
        }
        // live — строго булев opt-in; дефолт dry-run. limit/text/area только для apply.
        const result = runner.start({
          task: body.task,
          account: body.account,
          live: body.live === true,
          limit: body.limit,
          text: body.text,
          area: body.area,
        });
        const { status, ...rest } = result;
        sendJson(res, status || (result.ok ? 200 : 400), rest);
        return;
      }

      if (req.method === 'POST' && req.url === '/api/stop') {
        let body;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err.message });
          return;
        }
        // task — опциональный фильтр (M12.7): при указании останавливает только эту задачу аккаунта.
        const stopOpts = { account: body.account };
        if (body.task !== undefined) stopOpts.task = body.task;
        const result = runner.stop(stopOpts);
        const { status, ...rest } = result;
        sendJson(res, status || (result.ok ? 200 : 400), rest);
        return;
      }

      if (req.method === 'GET' && req.url === '/api/tasks') {
        sendJson(res, 200, { tasks: runner.list() });
        return;
      }

      if (req.method === 'GET' && req.url === '/api/accounts') {
        sendJson(res, 200, { accounts: await listAccounts() });
        return;
      }

      // --- Метрики и страница (GET) ---
      if (req.url === '/api/metrics') {
        const data = await collectMetrics();
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
        return;
      }
      if (req.url === '/api/live') {
        const data = await collectLive();
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
        return;
      }
      // SSE-стрим «Сейчас» (M13.3): read-only, как /api/live — без loopback-гарда.
      if (req.url === '/api/stream') {
        handleStream(req, res);
        return;
      }
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(PAGE);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Internal error');
    }
  });
}

// Точка входа — только при прямом вызове.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = parsePort(process.argv.slice(2));
  // ТОЛЬКО localhost — панель не торчит наружу.
  createServer().listen(port, '127.0.0.1', () => {
    console.log(`[dashboard] http://127.0.0.1:${port} — Ctrl-C для выхода`);
  });
}
