// Чистые функции расписания для МСК (Europe/Moscow).
// Все функции детерминированы: принимают явный Date, не вызывают Date.now() / new Date()
// без аргумента. Intl.DateTimeFormat используется для надёжного извлечения компонентов
// по МСК независимо от TZ операционной системы.

// МСК = UTC+3 круглый год (без перехода на летнее время с 2014).
// Офсет жёстко закодирован как константа для построения UTC-инстантов из МСК-компонентов.
const MSK_OFFSET_HOURS = 3;

// Рабочие часы по МСК: [WORK_START_HOUR, WORK_END_HOUR) — включительно начало, исключительно конец.
export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 18;

// Форматтер для разбора Date по Europe/Moscow.
// Используем 'en-GB' локаль: день/месяц/год — парсить удобно; weekday:'long' для будущей логики.
const _fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Moscow',
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'long',
});

/**
 * Извлекает компоненты даты/времени по Europe/Moscow из переданного Date.
 *
 * @param {Date} date — валидный Date-объект
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, weekday: string }}
 * @throws {TypeError} если date не является Date или является Invalid Date
 */
export function mskParts(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new TypeError('mskParts: ожидается валидный Date');
  }

  const parts = _fmt.formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;

  // hour из en-GB hour12:false может возвращать '24' вместо '0' для полуночи в некоторых средах.
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;

  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour,
    minute: parseInt(get('minute'), 10),
    weekday: get('weekday'),
  };
}

/**
 * Проверяет, попадает ли переданный момент в рабочие часы по МСК.
 * Рабочий диапазон: [WORK_START_HOUR, WORK_END_HOUR) — 7 дней в неделю.
 *
 * @param {Date} date
 * @returns {boolean}
 */
export function isWithinWorkingHours(date) {
  const { hour } = mskParts(date);
  return hour >= WORK_START_HOUR && hour < WORK_END_HOUR;
}

/**
 * Строит UTC-инстант для 09:00 МСК указанного дня (по МСК-компонентам year/month/day).
 * 09:00 МСК = 06:00 UTC (UTC+3).
 *
 * Допущение: фиксированный офсет UTC+3 (верно с 2014-10-26). Для дат до 2014 этот
 * конструктор разойдётся с Intl-чтением mskParts на ±1 час — вне операционного окна демона.
 *
 * @param {number} year
 * @param {number} month — 1-based (1=январь)
 * @param {number} day
 * @returns {Date}
 */
function mskDayStart(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, WORK_START_HOUR - MSK_OFFSET_HOURS, 0, 0, 0));
}

/**
 * Вычисляет следующий момент запуска.
 *
 * Семантика:
 * 1. Если date + intervalMinutes попадает ВНУТРЬ рабочих часов МСК → вернуть этот момент.
 * 2. Если результат >= 18:00 МСК или уже вышел за рамки рабочего окна → вернуть
 *    ближайшие 09:00 МСК:
 *      — если текущий МСК-час < 09:00 (ночь/раннее утро) → СЕГОДНЯШНИЕ 09:00 МСК;
 *      — иначе → ЗАВТРАШНИЕ 09:00 МСК.
 *
 * Функция полностью детерминирована от входных аргументов.
 *
 * @param {Date} date — текущий момент
 * @param {number} intervalMinutes — интервал в минутах (должен быть > 0; иначе используется 0,
 *   и date возвращается без изменений, если он внутри окна)
 * @returns {Date}
 */
export function nextRunAt(date, intervalMinutes) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new TypeError('nextRunAt: ожидается валидный Date');
  }

  // Нормализуем интервал: не конечное число или <= 0 (вкл. NaN/Infinity) → трактуем как 0.
  const mins = Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 0;

  const candidate = new Date(date.getTime() + mins * 60 * 1000);

  if (isWithinWorkingHours(candidate)) {
    return candidate;
  }

  // candidate вне рабочего окна → найти ближайшие 09:00 МСК.
  const { year, month, day, hour } = mskParts(date);

  if (hour < WORK_START_HOUR) {
    // Ночь или раннее утро в МСК — сегодняшние 09:00.
    return mskDayStart(year, month, day);
  }

  // День уже начался (>= 09:00), а кандидат вышел за 18:00 → завтрашние 09:00.
  // Строим UTC-инстант сегодняшнего 00:00 МСК и добавляем 1 день.
  const todayMskMidnight = new Date(Date.UTC(year, month - 1, day, -MSK_OFFSET_HOURS, 0, 0, 0));
  const tomorrowMskMidnight = new Date(todayMskMidnight.getTime() + 24 * 60 * 60 * 1000);
  const { year: ty, month: tm, day: td } = mskParts(tomorrowMskMidnight);
  return mskDayStart(ty, tm, td);
}
