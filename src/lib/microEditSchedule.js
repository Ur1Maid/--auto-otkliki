// Чистые функции планировщика микро-правок резюме для «очков активности» hh.ru (M5.3).
// Все функции детерминированы от входных аргументов: не вызывают Date.now() / new Date()
// без аргумента, не обращаются к файлам, сети или другим сайд-эффектам.
//
// Логика «можно ли сейчас / когда следующий раз» с двумя ограничениями:
//   cadenceMinutes  — желаемая каденция (не чаще чем раз в N минут)
//   cooldownMinutes — дополнительный кулдаун hh.ru (0 = только каденция)
// Оба ограничения берутся одновременно: effectiveInterval = max(cadence, cooldown).

/** Каденция микро-правок по умолчанию (в минутах). */
export const DEFAULT_CADENCE_MINUTES = 30;

/** Дополнительный кулдаун hh.ru по умолчанию (в минутах); 0 = только каденция. */
export const DEFAULT_COOLDOWN_MINUTES = 0;

/**
 * Вычисляет эффективный интервал между правками в минутах.
 * Возвращает максимум из нормализованных cadence и cooldown — нельзя действовать
 * чаще, чем разрешает более строгий лимит.
 *
 * Нормализация:
 *   cadenceMinutes  — не конечное или <= 0  → DEFAULT_CADENCE_MINUTES.
 *   cooldownMinutes — не конечное или < 0   → 0 (ноль допустим: «нет доп.кулдауна»).
 *
 * @param {number} [cadenceMinutes]  — желаемая каденция в минутах
 * @param {number} [cooldownMinutes] — кулдаун hh.ru в минутах
 * @returns {number}
 */
export function effectiveIntervalMinutes(cadenceMinutes, cooldownMinutes) {
  const cadence =
    Number.isFinite(cadenceMinutes) && cadenceMinutes > 0
      ? cadenceMinutes
      : DEFAULT_CADENCE_MINUTES;

  const cooldown =
    Number.isFinite(cooldownMinutes) && cooldownMinutes >= 0
      ? cooldownMinutes
      : DEFAULT_COOLDOWN_MINUTES;

  return Math.max(cadence, cooldown);
}

/**
 * Вычисляет момент, когда снова разрешено сделать микро-правку.
 * Результат: lastRunAt + effectiveIntervalMinutes(cadenceMinutes, cooldownMinutes).
 *
 * @param {Date}   lastRunAt       — момент последней выполненной правки (валидный Date)
 * @param {number} [cadenceMinutes]
 * @param {number} [cooldownMinutes]
 * @returns {Date}
 * @throws {TypeError} если lastRunAt не является валидным Date
 */
export function nextAllowedAt(lastRunAt, cadenceMinutes, cooldownMinutes) {
  if (!(lastRunAt instanceof Date) || isNaN(lastRunAt.getTime())) {
    throw new TypeError('nextAllowedAt: ожидается валидный Date');
  }

  const intervalMs = effectiveIntervalMinutes(cadenceMinutes, cooldownMinutes) * 60 * 1000;
  return new Date(lastRunAt.getTime() + intervalMs);
}

/**
 * Проверяет, можно ли сделать микро-правку в момент `now`.
 *
 * Семантика lastRunAt:
 *   null / undefined → аккаунт никогда не запускался → всегда true.
 *   валидный Date    → проверяем по интервалу.
 *   прочее (не-Date, не null/undefined) → TypeError.
 *
 * Граница включительна: если now.getTime() === nextAllowedAt(...).getTime() → true.
 *
 * @param {Date}        now
 * @param {Date|null|undefined} lastRunAt
 * @param {number}      [cadenceMinutes]
 * @param {number}      [cooldownMinutes]
 * @returns {boolean}
 * @throws {TypeError} если now не является валидным Date
 * @throws {TypeError} если lastRunAt не null/undefined и не является валидным Date
 */
export function canRunNow(now, lastRunAt, cadenceMinutes, cooldownMinutes) {
  if (!(now instanceof Date) || isNaN(now.getTime())) {
    throw new TypeError('canRunNow: ожидается валидный Date для now');
  }

  if (lastRunAt == null) {
    return true;
  }

  if (!(lastRunAt instanceof Date) || isNaN(lastRunAt.getTime())) {
    throw new TypeError('canRunNow: lastRunAt должен быть валидным Date, null или undefined');
  }

  return now.getTime() >= nextAllowedAt(lastRunAt, cadenceMinutes, cooldownMinutes).getTime();
}

/**
 * Возвращает количество минут до следующего разрешённого запуска.
 * 0 если уже можно или аккаунт никогда не запускался.
 * Результат не округляется — возможны дробные минуты.
 *
 * @param {Date}        now
 * @param {Date|null|undefined} lastRunAt
 * @param {number}      [cadenceMinutes]
 * @param {number}      [cooldownMinutes]
 * @returns {number}
 * @throws {TypeError} если now не является валидным Date
 * @throws {TypeError} если lastRunAt не null/undefined и не является валидным Date
 */
export function minutesUntilAllowed(now, lastRunAt, cadenceMinutes, cooldownMinutes) {
  if (!(now instanceof Date) || isNaN(now.getTime())) {
    throw new TypeError('minutesUntilAllowed: ожидается валидный Date для now');
  }

  if (lastRunAt == null) {
    return 0;
  }

  if (!(lastRunAt instanceof Date) || isNaN(lastRunAt.getTime())) {
    throw new TypeError('minutesUntilAllowed: lastRunAt должен быть валидным Date, null или undefined');
  }

  const diffMs = nextAllowedAt(lastRunAt, cadenceMinutes, cooldownMinutes).getTime() - now.getTime();
  return diffMs <= 0 ? 0 : diffMs / 60000;
}
