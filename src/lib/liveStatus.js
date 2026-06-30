// Чистый агрегатор «живого состояния» для блока «Сейчас» панели управления (M11.11).
// Сводит уже прочитанные источники в снимок: по аккаунту — текущая задача/шаг/прогресс,
// индикатор живости (работает/завис/капча/простаивает), последние события, плюс общий
// замер ресурсов (RSS/CPU). Без IO/сети/процесса: dashboard.js читает файлы
// (logs/status/<account>.json, logs/resources.jsonl, responses-<account>.jsonl) и передаёт
// сюда распарсенными; `now`/`withinWorkingHours` тоже инъектируются вызывающим.
//
// БЕЗОПАСНОСТЬ: наружу идут только числа/статусы/шаги. События аккаунта берём как {status, at}
// — без title/url/PII (вызывающий обязан не передавать сюда заголовки/ссылки вакансий).
//
// Использование (в dashboard.js):
//   const view = buildLiveView({ accounts, heartbeats, resources, eventsByAccount,
//                                now: new Date(), withinWorkingHours: isWithinWorkingHours(now) });

import { isStale } from './heartbeat.js';
import { formatPhase } from './runPhase.js';

/** Литералы индикатора живости (цвета в UI: working=зелёный, stalled=красный, captcha=оранжевый). */
export const LIVENESS_WORKING = 'working';
export const LIVENESS_STALLED = 'stalled';
export const LIVENESS_CAPTCHA = 'captcha';
export const LIVENESS_IDLE = 'idle';

/** Сколько последних событий аккаунта отдавать по умолчанию. */
const DEFAULT_EVENTS_LIMIT = 8;

/** Приводит момент к epoch-ms (Date / число / ISO-строка). Невалид → null. */
function toMs(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/** Приводит момент к ISO-строке; невалид → null. */
function toIso(value) {
  const ms = toMs(value);
  return ms == null ? null : new Date(ms).toISOString();
}

/** Конечное число → как есть, иначе null. */
function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

/**
 * Индикатор живости одного аккаунта по его хартбиту.
 *
 * Приоритет: капча > зависание > работа/простой. Капча «липкая» — важнее свежести
 * (на капче прогон стоит, хартбит всё равно перестаёт обновляться). Завершённый прогон
 * (phase==='done') — не «работает», показываем как простой (idle), а не зелёный/красный.
 *
 * @param {object} heartbeat — запись из buildHeartbeat (или прочитанная из файла); null → idle
 * @param {{ now?: Date|number|string, withinWorkingHours?: boolean, thresholdMs?: number }} [opts]
 * @returns {'working'|'stalled'|'captcha'|'idle'}
 */
export function accountLiveness(heartbeat, opts = {}) {
  if (!heartbeat || typeof heartbeat !== 'object') return LIVENESS_IDLE;
  if (heartbeat.state === 'captcha') return LIVENESS_CAPTCHA;
  if (heartbeat.phase === 'done') return LIVENESS_IDLE;

  let stale;
  try {
    stale = isStale(heartbeat, opts.now, opts.thresholdMs);
  } catch {
    stale = true; // невалидный now → считаем сигнал неживым
  }
  if (!stale) return LIVENESS_WORKING;
  // Устарел: «завис» только внутри рабочего окна (вне окна простой ожидаем — это idle).
  return opts.withinWorkingHours === true ? LIVENESS_STALLED : LIVENESS_IDLE;
}

/** Прогресс в процентах из index/total; вне диапазона/нет данных → null. */
function progressPct(index, total) {
  if (!Number.isFinite(index) || !Number.isFinite(total) || total <= 0) return null;
  const pct = (index / total) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
}

/** Санитизирует одно событие до {status, at} — без title/url/PII. Не-объект → null. */
function sanitizeEvent(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    status: typeof entry.status === 'string' ? entry.status : 'unknown',
    at: typeof entry.at === 'string' ? entry.at : null,
  };
}

/**
 * Строит снимок одного аккаунта для блока «Сейчас».
 *
 * @param {string} account — имя аккаунта
 * @param {object|null} heartbeat — хартбит этого аккаунта (или null, если файла статуса нет)
 * @param {object[]} events — события аккаунта (responses-<account>.jsonl), последние сверху
 * @param {object} opts — { now, withinWorkingHours, thresholdMs, eventsLimit }
 */
function buildLiveAccount(account, heartbeat, events, opts) {
  const hb = heartbeat && typeof heartbeat === 'object' ? heartbeat : null;
  const nowMs = toMs(opts.now);
  const tsMs = hb ? toMs(hb.ts) : null;
  const ageMs = nowMs != null && tsMs != null ? Math.max(0, nowMs - tsMs) : null;

  const index = hb ? finiteOrNull(hb.index) : null;
  const total = hb ? finiteOrNull(hb.total) : null;

  const limit =
    Number.isFinite(opts.eventsLimit) && opts.eventsLimit > 0
      ? Math.floor(opts.eventsLimit)
      : DEFAULT_EVENTS_LIMIT;
  const recentEvents = (Array.isArray(events) ? events : [])
    .map(sanitizeEvent)
    .filter(Boolean)
    .slice(-limit)
    .reverse();

  const phase = hb && typeof hb.phase === 'string' ? hb.phase : '';
  const lastEvent = hb && typeof hb.lastEvent === 'string' ? hb.lastEvent : '';
  const state = hb && typeof hb.state === 'string' ? hb.state : 'ok';

  return {
    account,
    task: hb && typeof hb.task === 'string' ? hb.task : '',
    phase,
    // Человекочитаемая фраза текущего шага для UI (M12.2). Пустой хартбит → «Простаивает».
    phaseLabel: hb ? formatPhase({ phase, index, total, state, lastEvent }) : 'Простаивает',
    index,
    total,
    progressPct: progressPct(index, total),
    lastEvent,
    state,
    ts: hb ? toIso(hb.ts) : null,
    ageMs,
    liveness: accountLiveness(hb, opts),
    recentEvents,
  };
}

/**
 * Сводит источники в снимок блока «Сейчас».
 *
 * Множество аккаунтов — объединение `accounts` (имена из config) и аккаунтов, у которых есть
 * хартбит. Аккаунт без хартбита показывается как idle (нет живого сигнала). Никогда не бросает.
 *
 * @param {object} [input]
 * @param {string[]} [input.accounts] — имена аккаунтов (из listAccounts)
 * @param {object[]} [input.heartbeats] — распарсенные logs/status/<account>.json (каждый с .account)
 * @param {object[]} [input.resources] — распарсенные строки logs/resources.jsonl
 * @param {Record<string, object[]>} [input.eventsByAccount] — события по аккаунту (только {status, at})
 * @param {Date|number|string} [input.now]
 * @param {boolean} [input.withinWorkingHours]
 * @param {number} [input.thresholdMs] — порог устаревания хартбита (мс)
 * @param {number} [input.eventsLimit] — сколько последних событий на аккаунт
 * @param {number} [input.resourcesLimit] — сколько последних замеров ресурсов вернуть
 * @returns {{
 *   accounts: object[],
 *   resources: { latest: object|null, recent: object[] },
 *   generatedAt: string|null,
 * }}
 */
export function buildLiveView(input = {}) {
  const opts = {
    now: input.now,
    withinWorkingHours: input.withinWorkingHours,
    thresholdMs: input.thresholdMs,
    eventsLimit: input.eventsLimit,
  };

  // Хартбиты по имени аккаунта (последний выигрывает при дублях).
  const hbByAccount = new Map();
  const hbList = Array.isArray(input.heartbeats) ? input.heartbeats : [];
  for (const hb of hbList) {
    if (hb && typeof hb === 'object' && typeof hb.account === 'string' && hb.account) {
      hbByAccount.set(hb.account, hb);
    }
  }

  // Объединяем явный список аккаунтов и тех, у кого есть хартбит.
  const names = new Set();
  for (const name of Array.isArray(input.accounts) ? input.accounts : []) {
    if (typeof name === 'string' && name) names.add(name);
  }
  for (const name of hbByAccount.keys()) names.add(name);

  const eventsByAccount =
    input.eventsByAccount && typeof input.eventsByAccount === 'object' ? input.eventsByAccount : {};

  const accounts = [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => buildLiveAccount(name, hbByAccount.get(name) || null, eventsByAccount[name], opts));

  const resList = (Array.isArray(input.resources) ? input.resources : []).filter(
    (r) => r && typeof r === 'object',
  );
  const resLimit =
    Number.isFinite(input.resourcesLimit) && input.resourcesLimit > 0
      ? Math.floor(input.resourcesLimit)
      : 30;
  const latest = resList.length ? resList[resList.length - 1] : null;
  const recent = resList.slice(-resLimit).reverse();

  return {
    accounts,
    resources: { latest, recent },
    generatedAt: toIso(input.now),
  };
}
