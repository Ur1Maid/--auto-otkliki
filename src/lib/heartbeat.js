// Чистые функции «хартбита» живого прогона для панели управления (M11.1).
// Все функции детерминированы от входных аргументов: не вызывают Date.now() / new Date()
// без аргумента, не обращаются к файлам/сети/процессу. IO (запись logs/status/<account>.json,
// чтение now) делает вызывающий код (review.js / daemon.js / dashboard.js).
//
// БЕЗОПАСНОСТЬ: хартбит несёт ТОЛЬКО числа/шаги/счётчики — ни ключа, ни PII, ни текста писем.
// Этот модуль лишь нормализует типы; вызывающий обязан не передавать в lastEvent чувствительное.
// Поле `counts` — белый список числовых ключей buildRunCounters; неизвестные ключи отбрасываются.
//
// Использование:
//   const hb = buildHeartbeat({ task: 'apply', account: 'acc1', phase: 'scoring',
//                               index: 12, total: 200, lastEvent: 'scored', state: 'ok', ts: new Date() });
//   // вызывающий: fs.writeFile(`logs/status/${account}.json`, JSON.stringify(hb))
//   const dead = isStale(hb, new Date(), 120000);

/** Порог устаревания хартбита по умолчанию (мс): нет обновления дольше → прогон считается «завис». */
export const DEFAULT_STALE_THRESHOLD_MS = 120000;

/** Состояние хартбита по умолчанию, если не передано/мусор. */
const DEFAULT_STATE = 'ok';

/**
 * Возвращает строку как есть, иначе пустую строку.
 * Намеренно НЕ применяет String() к объектам — это защита от случайного протекания
 * структур/PII в текстовые поля хартбита.
 */
function toStr(value) {
  return typeof value === 'string' ? value : '';
}

/** Конечное число → как есть, иначе 0. Используется в toCounts для счётчиков прогона. */
function toNum(v) {
  return Number.isFinite(v) ? v : 0;
}

/**
 * Принимает объект счётчиков прогона (buildRunCounters-совместимой формы) и возвращает
 * нормализованную копию с ТОЛЬКО белым списком числовых ключей.
 * Неизвестные ключи и любые нечисловые поля отбрасываются — гарантия защиты от протекания PII.
 * Не-plain-объект (null / массив / примитив) → null (поле не добавляется в хартбит).
 *
 * @param {unknown} value
 * @returns {{ viewed:number, sent:number, skipped:number, manual:number, alreadyApplied:number,
 *   errors:number, tokens:{ calls:number, promptTokens:number, completionTokens:number,
 *   totalTokens:number, cacheHitTokens:number, estimatedCostUsd:number } } | null}
 */
function toCounts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const t = value.tokens && typeof value.tokens === 'object' && !Array.isArray(value.tokens)
    ? value.tokens
    : {};
  return {
    viewed:        toNum(value.viewed),
    sent:          toNum(value.sent),
    skipped:       toNum(value.skipped),
    manual:        toNum(value.manual),
    alreadyApplied: toNum(value.alreadyApplied),
    errors:        toNum(value.errors),
    tokens: {
      calls:             toNum(t.calls),
      promptTokens:      toNum(t.promptTokens),
      completionTokens:  toNum(t.completionTokens),
      totalTokens:       toNum(t.totalTokens),
      cacheHitTokens:    toNum(t.cacheHitTokens),
      estimatedCostUsd:  toNum(t.estimatedCostUsd),
    },
  };
}

/**
 * Нормализует целочисленный счётчик прогресса: конечное число >= 0 → округлённое вниз,
 * иначе null («неизвестно»).
 */
function toCount(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

/**
 * Приводит момент времени к ISO-строке. Принимает Date / число (epoch ms) / ISO-строку.
 * Невалидный/отсутствующий вход → null.
 */
function toIso(value) {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  return null;
}

/**
 * Приводит момент к epoch-ms. Принимает Date / число / ISO-строку. Невалидный → null.
 */
function toMs(value) {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/**
 * Строит запись хартбита из полей живого прогона.
 * Никогда не бросает: не-объект/null на входе → запись со всеми дефолтами.
 *
 * @param {object} [fields]
 * @param {string} [fields.task]      — тип задачи (apply | messages | resume)
 * @param {string} [fields.account]   — имя аккаунта
 * @param {string} [fields.phase]     — текущий шаг/фаза
 * @param {number} [fields.index]     — индекс текущего элемента (вакансии/треда)
 * @param {number} [fields.total]     — всего элементов
 * @param {string} [fields.lastEvent] — короткая метка последнего события (без PII)
 * @param {string} [fields.state]     — состояние ('ok' | 'captcha' | 'stalled'); дефолт 'ok'
 * @param {Date|number|string} [fields.ts] — момент записи (Date / epoch ms / ISO); невалид → null
 * @param {object} [fields.counts] — снимок счётчиков прогона (buildRunCounters-форма);
 *   санитизируется: только числовые ключи белого списка, неизвестные отбрасываются.
 *   Отсутствует в возвращаемом объекте, если не передано или не plain-object.
 * @returns {{
 *   task: string, account: string, phase: string,
 *   index: number|null, total: number|null,
 *   lastEvent: string, state: string, ts: string|null,
 *   counts?: object,
 * }}
 */
export function buildHeartbeat(fields) {
  const f = fields && typeof fields === 'object' ? fields : {};
  const state = typeof f.state === 'string' && f.state.trim() !== '' ? f.state : DEFAULT_STATE;

  const hb = {
    task: toStr(f.task),
    account: toStr(f.account),
    phase: toStr(f.phase),
    index: toCount(f.index),
    total: toCount(f.total),
    lastEvent: toStr(f.lastEvent),
    state,
    ts: toIso(f.ts),
  };
  const counts = toCounts(f.counts);
  if (counts) hb.counts = counts;
  return hb;
}

/**
 * Проверяет, «завис» ли прогон: возраст хартбита больше порога.
 *
 * Консервативная семантика (при сомнении считаем устаревшим):
 *   - heartbeat не объект / null / без разбираемого ts → true (нет живого сигнала);
 *   - возраст в будущем (ts > now) → false (не устарел);
 *   - граница включительна-свежая: возраст === threshold → false (ещё свежий).
 *
 * @param {object} heartbeat — запись из buildHeartbeat (или прочитанная из файла)
 * @param {Date|number|string} now — текущий момент (Date / epoch ms / разбираемая ISO-строка)
 * @param {number} [thresholdMs] — порог устаревания; не конечный/<=0 → DEFAULT_STALE_THRESHOLD_MS
 * @returns {boolean}
 * @throws {TypeError} если now не приводится к валидному моменту времени
 */
export function isStale(heartbeat, now, thresholdMs) {
  const nowMs = toMs(now);
  if (nowMs == null) {
    throw new TypeError('isStale: ожидается валидный Date или epoch ms для now');
  }

  if (!heartbeat || typeof heartbeat !== 'object') {
    return true;
  }

  const tsMs = toMs(heartbeat.ts);
  if (tsMs == null) {
    return true;
  }

  const threshold =
    Number.isFinite(thresholdMs) && thresholdMs > 0 ? thresholdMs : DEFAULT_STALE_THRESHOLD_MS;

  const ageMs = nowMs - tsMs;
  return ageMs > threshold;
}
