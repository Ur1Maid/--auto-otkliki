// Человеческий ритм: рандомизированные паузы между действиями (анти-бот-пейсинг).
// Чистый расчёт длительности паузы; сам «сон» делает вызывающий через
// page.waitForTimeout(...). rand инжектируется для детерминированных тестов.

/**
 * Случайная задержка в миллисекундах в диапазоне [minMs, maxMs] (включительно).
 * Перепутанные границы терпятся (меняются местами). Некорректные входы → 0.
 *
 * @param {number} minMs — нижняя граница, мс
 * @param {number} maxMs — верхняя граница, мс
 * @param {() => number} [rand=Math.random] — источник случайности (0..1)
 * @returns {number} целое число мс в [minMs, maxMs]
 */
export function randomDelayMs(minMs, maxMs, rand = Math.random) {
  let lo = Number.isFinite(minMs) ? Math.max(0, Math.floor(minMs)) : 0;
  let hi = Number.isFinite(maxMs) ? Math.max(0, Math.floor(maxMs)) : 0;
  if (hi < lo) {
    const tmp = lo;
    lo = hi;
    hi = tmp;
  }
  const raw = typeof rand === 'function' ? rand() : Math.random();
  const r = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999) : 0;
  return lo + Math.floor(r * (hi - lo + 1));
}
