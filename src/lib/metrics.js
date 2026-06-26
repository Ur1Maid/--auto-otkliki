// Чистые агрегаторы метрик для дашборда. Без IO/сети — принимают уже прочитанные
// данные (массивы/объекты), возвращают агрегаты. Тестируемо и детерминировано.
//
// Источники (читает их dashboard.js, сюда передаёт распарсенными):
//   - responses-*.jsonl: { url, status, title, account, at }
//   - summary-*.json:    { account, applied, viewed, ..., locallyScored, modelScored, cachedScored, tokensRunCumulative }
//   - daily-*.json:      { date, applications, messages, resume, tokens }
//
// PRIVACY: метрики — это ЧИСЛА и статусы. Заголовки/URL вакансий не агрегируем в выдачу
// (могут быть PII работодателя); только счётчики.

/** Статус успешного отклика в responses-*.jsonl. */
export const APPLIED_STATUS = 'clicked';

/**
 * Парсит JSONL-текст в массив объектов. Битые строки пропускаются. Never throws.
 * @param {string} text
 * @returns {object[]}
 */
export function parseJsonl(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      const obj = JSON.parse(s);
      if (obj && typeof obj === 'object') out.push(obj);
    } catch {
      // битая строка — пропускаем
    }
  }
  return out;
}

/** Возвращает дату (YYYY-MM-DD) из ISO-строки или '' если не распознать. */
function dayOf(at) {
  if (typeof at !== 'string' || at.length < 10) return '';
  const d = at.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

/**
 * Агрегирует записи откликов (responses-*.jsonl).
 * @param {object[]} entries
 * @returns {{
 *   total: number,
 *   applied: number,
 *   byStatus: Record<string, number>,
 *   byAccount: Record<string, { total: number, applied: number, errors: number }>,
 *   daily: Array<{ day: string, total: number, applied: number, errors: number }>,
 * }}
 */
export function aggregateResponses(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const byStatus = {};
  const byAccount = {};
  const dailyMap = {};
  let applied = 0;

  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const status = typeof e.status === 'string' ? e.status : 'unknown';
    const account = typeof e.account === 'string' && e.account ? e.account : 'default';
    const isApplied = status === APPLIED_STATUS;
    const isError = status === 'error';

    byStatus[status] = (byStatus[status] || 0) + 1;
    if (isApplied) applied += 1;

    if (!byAccount[account]) byAccount[account] = { total: 0, applied: 0, errors: 0 };
    byAccount[account].total += 1;
    if (isApplied) byAccount[account].applied += 1;
    if (isError) byAccount[account].errors += 1;

    const day = dayOf(e.at);
    if (day) {
      if (!dailyMap[day]) dailyMap[day] = { day, total: 0, applied: 0, errors: 0 };
      dailyMap[day].total += 1;
      if (isApplied) dailyMap[day].applied += 1;
      if (isError) dailyMap[day].errors += 1;
    }
  }

  const daily = Object.values(dailyMap).sort((a, b) => a.day.localeCompare(b.day));
  return { total: list.length, applied, byStatus, byAccount, daily };
}

/**
 * Нормализует поле tokensRunCumulative. review.js пишет туда объект
 * { calls, promptTokens, completionTokens, totalTokens, cacheHitTokens }; старые
 * прогоны могли писать число (тогда трактуем его как totalTokens). Never throws.
 * @param {object|number|undefined} t
 * @returns {{ calls: number, promptTokens: number, completionTokens: number, totalTokens: number, cacheHitTokens: number }}
 */
function normTokens(t) {
  const num = (v) => (Number.isFinite(v) ? v : 0);
  if (typeof t === 'number') {
    return { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: num(t), cacheHitTokens: 0 };
  }
  if (!t || typeof t !== 'object') {
    return { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0 };
  }
  const prompt = num(t.promptTokens);
  const completion = num(t.completionTokens);
  return {
    calls: num(t.calls),
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: num(t.totalTokens) || prompt + completion,
    cacheHitTokens: num(t.cacheHitTokens),
  };
}

/**
 * Агрегирует per-account summary-*.json: скоринг (локально/модель/кэш) и токены.
 * tokensRunCumulative — объект (см. normTokens); раскладываем по компонентам и считаем
 * РЕАЛЬНЫЙ context-cache hit ratio DeepSeek (cacheHitTokens / promptTokens).
 * @param {object[]} summaries
 * @returns {{
 *   accounts: Array<object>,
 *   totals: { applied: number, viewed: number, errors: number, locallyScored: number, modelScored: number, cachedScored: number, tokens: number, promptTokens: number, completionTokens: number, cacheHitTokens: number },
 *   cacheHitRatio: number,
 *   tokenCacheHitRatio: number,
 * }}
 */
export function aggregateSummaries(summaries) {
  const list = Array.isArray(summaries) ? summaries : [];
  const totals = {
    applied: 0, viewed: 0, errors: 0, locallyScored: 0, modelScored: 0, cachedScored: 0,
    tokens: 0, promptTokens: 0, completionTokens: 0, cacheHitTokens: 0,
  };
  const num = (v) => (Number.isFinite(v) ? v : 0);

  const accounts = list
    .filter((s) => s && typeof s === 'object')
    .map((s) => {
      const tok = normTokens(s.tokensRunCumulative);
      const a = {
        account: typeof s.account === 'string' ? s.account : 'default',
        applied: num(s.applied),
        viewed: num(s.viewed),
        errors: num(s.errors),
        locallyScored: num(s.locallyScored),
        modelScored: num(s.modelScored),
        cachedScored: num(s.cachedScored),
        tokens: tok.totalTokens,
        promptTokens: tok.promptTokens,
        completionTokens: tok.completionTokens,
        cacheHitTokens: tok.cacheHitTokens,
      };
      totals.applied += a.applied;
      totals.viewed += a.viewed;
      totals.errors += a.errors;
      totals.locallyScored += a.locallyScored;
      totals.modelScored += a.modelScored;
      totals.cachedScored += a.cachedScored;
      totals.tokens += a.tokens;
      totals.promptTokens += a.promptTokens;
      totals.completionTokens += a.completionTokens;
      totals.cacheHitTokens += a.cacheHitTokens;
      return a;
    });

  const scoredTotal = totals.locallyScored + totals.modelScored + totals.cachedScored;
  const cacheHitRatio = scoredTotal > 0 ? totals.cachedScored / scoredTotal : 0;
  const tokenCacheHitRatio = totals.promptTokens > 0 ? totals.cacheHitTokens / totals.promptTokens : 0;
  return { accounts, totals, cacheHitRatio, tokenCacheHitRatio };
}

/**
 * Складывает дневные отчёты (daily-*.json) в тренд по дням.
 * @param {object[]} dailies
 * @returns {Array<{ date: string, applied: number, messagesProcessed: number, replied: number, resumeEdits: number, tokens: number }>}
 */
export function aggregateDaily(dailies) {
  const list = Array.isArray(dailies) ? dailies : [];
  const num = (v) => (Number.isFinite(v) ? v : 0);
  return list
    .filter((d) => d && typeof d === 'object' && typeof d.date === 'string')
    .map((d) => ({
      date: d.date,
      applied: num(d.applications?.applied),
      messagesProcessed: num(d.messages?.processed),
      replied: num(d.messages?.replied),
      resumeEdits: num(d.resume?.editsApplied),
      tokens: num(d.tokens?.promptTokens) + num(d.tokens?.completionTokens),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Оценка стоимости токенов DeepSeek (USD). Цены — приблизительные, задаются явно.
 * Дефолты (за 1M токенов): вход cache-miss $0.27, вход cache-hit $0.07, выход $1.10.
 * @param {{ promptTokens?: number, completionTokens?: number, cacheHitTokens?: number }} tokens
 * @param {{ inMissPerM?: number, inHitPerM?: number, outPerM?: number }} [pricing]
 * @returns {number} стоимость в USD
 */
export function estimateCost(tokens = {}, pricing = {}) {
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const inMiss = pricing.inMissPerM ?? 0.27;
  const inHit = pricing.inHitPerM ?? 0.07;
  const out = pricing.outPerM ?? 1.10;
  const prompt = num(tokens.promptTokens);
  const hit = Math.min(num(tokens.cacheHitTokens), prompt);
  const miss = Math.max(0, prompt - hit);
  const completion = num(tokens.completionTokens);
  return (miss / 1e6) * inMiss + (hit / 1e6) * inHit + (completion / 1e6) * out;
}

/**
 * Воронка конверсии. Стадии: отклики → вовлечённые работодатели (прокси: треды, где
 * работодатель писал и мы их осмотрели) → отправленные ответы.
 * conversion = вовлечённые / отклики (в %).
 *
 * Прокси «пришло в телеграм» = вовлечённые работодатели (ответили / попросили контакт):
 * прямой интеграции с TG нет, считаем по активности чата.
 *
 * @param {{ applied?: number, messagesProcessed?: number, replied?: number }} input
 * @returns {{ stages: Array<{ key: string, label: string, value: number }>, conversionPct: number, replyRatePct: number }}
 */
export function computeFunnel({ applied = 0, messagesProcessed = 0, replied = 0 } = {}) {
  const num = (v) => (Number.isFinite(v) ? Math.max(0, v) : 0);
  const a = num(applied);
  const engaged = num(messagesProcessed);
  const r = num(replied);
  const conversionPct = a > 0 ? (engaged / a) * 100 : 0;
  const replyRatePct = engaged > 0 ? (r / engaged) * 100 : 0;
  return {
    stages: [
      { key: 'applied', label: 'Отклики', value: a },
      { key: 'engaged', label: 'Вовлечённые работодатели (прокси TG-лидов)', value: engaged },
      { key: 'replied', label: 'Отправлено ответов', value: r },
    ],
    conversionPct,
    replyRatePct,
  };
}

/**
 * Агрегирует записи алертов (logs/alerts.jsonl: { at, level, code, message }).
 * Сообщения алертов содержат только счётчики/фиксированные строки — PII там нет
 * (см. src/lib/alerts.js), поэтому их безопасно отдавать на дашборд.
 * @param {object[]} entries — распарсенный alerts.jsonl
 * @param {number} [limit=20] — сколько последних алертов вернуть
 * @returns {{
 *   total: number,
 *   byLevel: { critical: number, warn: number },
 *   byCode: Record<string, number>,
 *   recent: Array<{ at: string|null, level: string, code: string, message: string }>,
 * }}
 */
export function aggregateAlerts(entries, limit = 20) {
  const list = Array.isArray(entries) ? entries : [];
  const byLevel = { critical: 0, warn: 0 };
  const byCode = {};
  const valid = [];

  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const level = e.level === 'critical' ? 'critical' : e.level === 'warn' ? 'warn' : null;
    if (!level) continue;
    const code = typeof e.code === 'string' && e.code ? e.code : 'unknown';
    byLevel[level] += 1;
    byCode[code] = (byCode[code] || 0) + 1;
    valid.push({
      at: typeof e.at === 'string' ? e.at : null,
      level,
      code,
      message: typeof e.message === 'string' ? e.message : '',
    });
  }

  // alerts.jsonl — append-only: хвост = самые свежие. Отдаём последние limit, новые сверху.
  const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;
  const recent = valid.slice(-n).reverse();
  return { total: valid.length, byLevel, byCode, recent };
}
