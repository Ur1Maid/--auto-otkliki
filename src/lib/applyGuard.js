// Решает, можно ли выполнять реальную отправку отклика (false в --dry-run).
// Спроектировано расширяемым: позже сюда можно добавить другие условия блокировки отправки.

/**
 * Возвращает true, если отправка отклика разрешена.
 * В режиме --dry-run (dryRun === true) возвращает false.
 * @param {{ dryRun?: boolean }} opts
 * @returns {boolean}
 */
export function isSubmitAllowed({ dryRun = false } = {}) {
  return dryRun !== true;
}
