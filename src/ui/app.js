// src/ui/app.js — клиентская логика панели hh-auto-otkliki (было — inline <script> в
// dashboard.js PAGE). Транспорт заменён с fetch('/api/...') на window.api.* (IPC-мост
// из src/preload.cjs); вся остальная логика (рендеринг, графики, таймеры) — без изменений.

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
let lastMetrics = null; // снимок метрик для блока «Сейчас» (токены/стоимость).
async function load() {
  // Метрики тянем всегда (нужны блоку «Сейчас» для токенов/стоимости), но тяжёлые
  // карточки/графики истории рисуем только когда блок «История» раскрыт: Chart.js в
  // свёрнутом <details> рендерится с нулевым размером.
  let m;
  try { m = await window.api.metrics(); }
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
// Аккаунты с state='logged_out' (из блока «Сейчас») — подсветка кнопки «Войти» (M19.6).
const loggedOutAccounts = {};

async function loadControl() {
  let accRes, taskRes;
  try {
    [accRes, taskRes] = await Promise.all([
      window.api.accounts(),
      window.api.tasks(),
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
    '<div id="' + accCtlId(acc) + '" style="margin-bottom: 14px; border: 1px solid #242832; border-radius: 8px; padding: 10px 12px">' +
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
    // Строка «Вход» (M19.6): Войти / Готово / Стоп — отдельно от откликов/сообщений/резюме.
    (() => {
      const key = acc + '\0' + 'login';
      const run = byAccTask[key];
      const running = !!run;
      let stTxt, stCls;
      if (running) {
        stTxt = 'идёт вход' + (run.pid != null ? ' · pid ' + esc(run.pid) : '');
        stCls = 'st-run';
      } else if (controlStopped[key]) {
        stTxt = 'остановлено'; stCls = 'st-stop';
      } else {
        stTxt = 'простаивает'; stCls = 'st-idle';
      }
      // Подсветка «Войти», когда сессия разлогинена (данные из блока «Сейчас»).
      const need = !!loggedOutAccounts[acc] && !running;
      return '<div class="ctl-row">' +
        '<div style="min-width: 90px; font-size: 13px">Вход</div>' +
        '<button class="ctl-login' + (need ? ' ctl-login-need' : '') + '" data-action="login" data-idx="' + i + '"' +
          (running ? ' disabled' : '') + '>Войти</button>' +
        '<button data-action="login-done" data-idx="' + i + '"' +
          (running ? '' : ' disabled') + '>Готово (сохранить вход)</button>' +
        '<button class="ctl-stop" data-action="stop" data-idx="' + i + '" data-task="login"' +
          (running ? '' : ' disabled') + '>Стоп</button>' +
        '<div class="ctl-status ' + stCls + '">' + stTxt + '</div>' +
        '</div>';
    })() +
    '</div>'
  ).join('');

  el.querySelectorAll('button[data-action="start"]').forEach(b =>
    b.addEventListener('click', () => startTask(+b.dataset.idx, b.dataset.task)));
  el.querySelectorAll('button[data-action="stop"]').forEach(b =>
    b.addEventListener('click', () => stopTask(+b.dataset.idx, b.dataset.task)));
  el.querySelectorAll('button[data-action="login"]').forEach(b =>
    b.addEventListener('click', () => startTask(+b.dataset.idx, 'login')));
  el.querySelectorAll('button[data-action="login-done"]').forEach(b =>
    b.addEventListener('click', () => loginDone(+b.dataset.idx)));
}

async function startTask(i, task) {
  const acc = controlAccounts[i];
  if (!acc) return;
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
    const json = await window.api.start(payload);
    if (!json || json.ok === false) alert('Не удалось запустить: ' + ((json && json.reason) || ''));
  } catch (e) {
    alert('Ошибка запуска');
  }
  loadControl();
}

async function stopTask(i, task) {
  const acc = controlAccounts[i];
  if (!acc) return;
  try {
    const json = await window.api.stop({ account: acc, task });
    if (json && json.ok) controlStopped[acc + '\0' + task] = true;
    else alert('Не удалось остановить: ' + ((json && json.reason) || ''));
  } catch (e) {
    alert('Ошибка остановки');
  }
  loadControl();
}

// «Готово (сохранить вход)» — сигнал завершения логина (M19.6): пишет sentinel через IPC.
async function loginDone(i) {
  const acc = controlAccounts[i];
  if (!acc) return;
  try {
    const json = await window.api.loginDone({ account: acc });
    if (!json || !json.ok) alert('Не удалось сохранить вход: ' + ((json && json.error) || ''));
  } catch (e) {
    alert('Ошибка сохранения входа');
  }
  loadControl();
}

// --- Блок «Сейчас» (M11.11, обновлён M12.8): живое состояние — одна строка на (аккаунт, задачу) ---
const LIVENESS_LABEL = { working: 'работает', stalled: 'завис', captcha: 'капча', limit: 'лимит откликов', logged_out: 'разлогин', idle: 'простой' };
const LIVE_TASK_LABEL = { apply: 'Отклики', messages: 'Сообщения', resume: 'Резюме' };
// Якорь per-account контейнера в блоке «Управление» — цель «→ Войти» из блока «Сейчас» (M19.3).
function accCtlId(acc) { return 'ctl-acc-' + String(acc).replace(/[^A-Za-z0-9_-]/g, '_'); }
// Реестр Chart-инстансов мини-графиков текущего прогона (M17.4).
// Ключ: account + '__' + task. Инстансы уничтожаются перед пересборкой DOM,
// чтобы не натекать при каждом тике обновления.
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
  try { v = await window.api.live(); }
  catch (e) { document.getElementById('liveBody').innerHTML = '<div class="err">Ошибка загрузки</div>'; return; }
  renderLive(v);
}

function renderLive(v) {
  if (!v) return;
  // Пересобираем набор разлогиненных аккаунтов — подсветка кнопки «Войти» в «Управлении» (M19.6).
  for (const k of Object.keys(loggedOutAccounts)) delete loggedOutAccounts[k];
  for (const a of (v.accounts || [])) if ((a.liveness || 'idle') === 'logged_out') loggedOutAccounts[a.account] = true;
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
    // При разлогине — инлайн-призыв «→ Войти», ведущий к управлению аккаунтом (M19.3).
    const loginCall = live === 'logged_out'
      ? '<span class="live-login-call" data-login-acc="' + esc(a.account) + '">→ Войти</span>'
      : '';
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
      ? '<div class="live-chart-wrap"><canvas id="' + canvasId + '" width="64" height="64"></canvas>' +
        '<span class="muted" style="font-size:11px">отпр.&nbsp;<b style="color:#7bd88f">' + esc(c.sent) + '</b>' +
        '&nbsp;· пропущ.&nbsp;<b style="color:#8a8f98">' + esc(c.skipped) + '</b>' +
        '&nbsp;· уже&nbsp;<b style="color:#4cafef">' + esc(c.alreadyApplied) + '</b>' +
        '&nbsp;· ошиб.&nbsp;<b style="color:#ff6b6b">' + esc(c.errors) + '</b></span></div>'
      : '';
    return '<div class="live-row" data-chart-key="' + chartKey + '" data-canvas-id="' + canvasId + '">' +
      '<div class="live-acc"><span class="live-dot lv-' + esc(live) + '"></span>' + esc(a.account) + '</div>' +
      '<div class="live-task">' + (taskTxt || '<span class="muted">простаивает</span>') +
        phaseTxt + (taskTxt ? ' <span class="st-' + livCls + '">(' + (LIVENESS_LABEL[live] || live) + ')</span>' : '') + loginCall + '</div>' +
      '<div class="live-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="live-meta">' + fmtAge(a.ageMs) + '</div>' +
      '<div class="live-events">' + (events || '—') + '</div>' +
      (countsTxt ? '<div class="live-counts">' + countsTxt + '</div>' : '') +
      chartHtml +
      '</div>';
  }).join('');

  // «→ Войти» при разлогине ведёт к блоку «Управление» аккаунта (M19.3).
  el.querySelectorAll('.live-login-call').forEach(s =>
    s.addEventListener('click', () => scrollToLogin(s.dataset.loginAcc)));

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
        // Фикс размера доната (M17.4): без этого Chart.js (responsive:true по умолчанию)
        // игнорирует width/height канваса и растягивает донат на всю ширину строки.
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ctx.label + ': ' + ctx.parsed } },
        },
        cutout: '60%',
      },
    });
  }
}

// Скролл/подсветка блока «Управление» аккаунта из призыва «→ Войти» (M19.3).
// Кнопка «Войти» живёт здесь (M19.6) и подсвечивается при разлогине (ctl-login-need).
function scrollToLogin(account) {
  const container = document.getElementById(accCtlId(account));
  const target = container || document.getElementById('controlBody');
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (container) {
    container.classList.add('ctl-highlight');
    setTimeout(() => container.classList.remove('ctl-highlight'), 2000);
  }
}

// Живое обновление блока «Сейчас» (было SSE в dashboard.js, теперь — IPC-пуш из
// electron-main.js: main-процесс сам следит за mtime файлов и шлёт снимок при изменении).
function startLiveStream() {
  if (window.api && typeof window.api.onLiveUpdate === 'function') {
    window.api.onLiveUpdate((data) => { try { renderLive(data); } catch (e) {} });
  }
  loadLive(); // начальный снимок
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
