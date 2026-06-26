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
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { logsDir } from './config.js';
import {
  parseJsonl,
  aggregateResponses,
  aggregateSummaries,
  aggregateDaily,
  estimateCost,
  computeFunnel,
} from './lib/metrics.js';

const DEFAULT_PORT = 8787;

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
  };
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
  button { background: #242832; color: #e6e6e6; border: 1px solid #333; border-radius: 8px; padding: 6px 12px; cursor: pointer; }
</style>
</head>
<body>
  <h1>hh-auto-otkliki — панель метрик</h1>
  <div class="sub">Локально, только чтение логов. <span id="gen"></span> <button onclick="load()">Обновить</button></div>
  <div class="cards" id="cards"></div>
  <div class="grid">
    <div class="panel"><h2>Отклики по дням</h2><canvas id="byDay"></canvas></div>
    <div class="panel"><h2>Отклики по статусу</h2><canvas id="byStatus"></canvas></div>
    <div class="panel"><h2>Отклики по аккаунтам</h2><canvas id="byAccount"></canvas></div>
    <div class="panel"><h2>Воронка конверсии</h2><canvas id="funnel"></canvas></div>
    <div class="panel"><h2>Скоринг (локально / модель / кэш)</h2><canvas id="scoring"></canvas></div>
    <div class="panel"><h2>Сообщения по дням</h2><canvas id="messages"></canvas></div>
  </div>
<script>
const charts = {};
function chart(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart(document.getElementById(id), cfg); }
function card(v, l) { return '<div class="card"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }
async function load() {
  let m;
  try { m = await (await fetch('/api/metrics')).json(); }
  catch (e) { document.getElementById('cards').innerHTML = '<div class="card err">Ошибка загрузки</div>'; return; }
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
    card((m.responses.byStatus.error || 0), 'Ошибок');

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
load();
</script>
</body>
</html>`;

/** Создаёт http-сервер (не слушает — для тестов). */
export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.url === '/api/metrics') {
        const data = await collectMetrics();
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
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
