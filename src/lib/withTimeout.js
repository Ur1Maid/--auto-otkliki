// Таймаут-гард против вечного зависания живого флоу (M16.4).
// Оборачивает «подвисающий» промис (открытие chatik-фрейма, сбор/навигация поиска) гонкой
// с таймером: если промис не осел за ms — резолвится onTimeoutValue (НЕ бросает на таймаут —
// это graceful-стоп шага, а не ошибка наружу). Реальный сон/IO делает вызывающий; здесь —
// только Promise-арифметика + один setTimeout/clearTimeout. Таймер всегда очищается.

/**
 * Гонка промиса против таймаута.
 *
 * Контракт:
 *   - promise осел раньше ms → резолв/реджект как у promise (отклонение пробрасывается —
 *     решает вызывающий, обычно через .catch/try; таймаут-гард не маскирует ошибку);
 *   - promise НЕ осел за ms → резолв `onTimeoutValue` (никогда не бросает на таймаут);
 *   - ms нечисло/<=0 → гонки нет, возвращается сам промис (поведение без гарда);
 *   - таймер очищается в любом исходе (нет висящего setTimeout, держащего event loop);
 *   - если promise отклоняется уже ПОСЛЕ выигравшего таймаута — отклонение молча
 *     проглатывается (нет unhandled rejection; наружу уже ушёл onTimeoutValue).
 *
 * Чистая в смысле детерминизма: единственный сайд-эффект — setTimeout/clearTimeout;
 * Date.now()/Math.random() не зовёт, файлов/сети/DOM не трогает.
 *
 * @template T
 * @param {Promise<T> | T} promise — потенциально подвисающая операция (или готовое значение)
 * @param {number} ms — таймаут в миллисекундах
 * @param {T|*} [onTimeoutValue] — что вернуть при превышении таймаута (по умолчанию undefined)
 * @returns {Promise<T|*>}
 */
export function withTimeout(promise, ms, onTimeoutValue) {
  const p = Promise.resolve(promise);
  if (!Number.isFinite(ms) || ms <= 0) return p;

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(onTimeoutValue);
    }, ms);

    p.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        // Таймаут уже выиграл → проглатываем отклонение (без unhandled rejection).
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
