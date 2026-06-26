// Чистый планировщик решений дневного демона hh-auto-otkliki (M7.2).
// Принимает (now, state, config) и детерминированно возвращает ОДНО следующее действие.
// Без IO, сети, сайд-эффектов, Date.now() — только чистая логика.
//
// Порядок приоритета:
//   1. STOP           — вне рабочих часов МСК (демон не действует вне окна [9, 18))
//   2. APPLY_RUN      — стартовый прогон 200 откликов + тейлоринг ещё не выполнен
//   3. POLL_MESSAGES  — настала каденция поллинга сообщений (более чувствительны ко времени)
//   4. MICRO_EDIT     — настала каденция микро-правок резюме
//   5. IDLE           — сейчас нечего делать; возвращает nextCheckInMinutes

import { isWithinWorkingHours } from './schedule.js';
import { canRunNow, minutesUntilAllowed } from './microEditSchedule.js';

/** Каденция поллинга сообщений по умолчанию (в минутах). */
export const MESSAGES_POLL_MINUTES = 15;

/** Каденция микро-правок резюме по умолчанию (в минутах). */
export const MICRO_EDIT_MINUTES = 30;

/** Доступные действия демона. */
export const ACTIONS = Object.freeze({
  STOP: 'stop',
  APPLY_RUN: 'apply_run',
  POLL_MESSAGES: 'poll_messages',
  MICRO_EDIT: 'micro_edit',
  IDLE: 'idle',
});

/**
 * Нормализует значение минут: возвращает value если Number.isFinite && > 0, иначе defaultVal.
 *
 * @param {*} value
 * @param {number} defaultVal
 * @returns {number}
 */
function normalizeMinutes(value, defaultVal) {
  return Number.isFinite(value) && value > 0 ? value : defaultVal;
}

/**
 * Детерминированно выбирает следующее действие демона.
 *
 * @param {object} [options={}]
 * @param {Date}   options.now                  — текущий момент (обязателен; guard → TypeError)
 * @param {object} [options.state]              — состояние демона; не-объект трактуется как {}
 * @param {boolean} [options.state.startupDone] — выполнен ли стартовый прогон
 * @param {Date|null} [options.state.lastMessagesPollAt] — время последнего поллинга сообщений
 * @param {Date|null} [options.state.lastMicroEditAt]    — время последней микро-правки
 * @param {object} [options.config]             — конфиг; не-объект трактуется как {}
 * @param {number} [options.config.messagesPollMinutes]  — каденция сообщений (>0; иначе дефолт)
 * @param {number} [options.config.microEditMinutes]     — каденция микро-правок (>0; иначе дефолт)
 * @returns {{ action: string, reason: string, nextCheckInMinutes?: number }}
 * @throws {TypeError} если now не является валидным Date
 */
export function decideNextAction({ now, state, config } = {}) {
  // Guard: now обязан быть валидным Date.
  if (!(now instanceof Date) || isNaN(now.getTime())) {
    throw new TypeError('decideNextAction: ожидается валидный Date для now');
  }

  // Нормализуем state и config: не-объект → пустой объект.
  const s = (state !== null && typeof state === 'object') ? state : {};
  const c = (config !== null && typeof config === 'object') ? config : {};

  // Нормализуем каденции из config, падаем обратно на константы.
  const messagesPollMinutes = normalizeMinutes(c.messagesPollMinutes, MESSAGES_POLL_MINUTES);
  const microEditMinutes = normalizeMinutes(c.microEditMinutes, MICRO_EDIT_MINUTES);

  // 1. Вне рабочих часов МСК — стоп.
  if (!isWithinWorkingHours(now)) {
    return { action: ACTIONS.STOP, reason: 'outside_working_hours' };
  }

  // 2. Стартовый прогон не выполнен.
  if (s.startupDone !== true) {
    return { action: ACTIONS.APPLY_RUN, reason: 'startup' };
  }

  // 3. Настала каденция поллинга сообщений (приоритетнее).
  if (canRunNow(now, s.lastMessagesPollAt ?? null, messagesPollMinutes)) {
    return { action: ACTIONS.POLL_MESSAGES, reason: 'messages_due' };
  }

  // 4. Настала каденция микро-правок.
  if (canRunNow(now, s.lastMicroEditAt ?? null, microEditMinutes)) {
    return { action: ACTIONS.MICRO_EDIT, reason: 'micro_edit_due' };
  }

  // 5. Ничего не нужно — ждём до ближайшей каденции.
  const minsToMessages = minutesUntilAllowed(now, s.lastMessagesPollAt ?? null, messagesPollMinutes);
  const minsToMicroEdit = minutesUntilAllowed(now, s.lastMicroEditAt ?? null, microEditMinutes);
  const nextCheckInMinutes = Math.max(0, Math.min(minsToMessages, minsToMicroEdit));

  return { action: ACTIONS.IDLE, reason: 'nothing_due', nextCheckInMinutes };
}
