// Примитив изоляции ошибок для дневного демона hh-auto-otkliki (M7.3).
// Гарантирует: один упавший элемент/задача НЕ прерывает остальные и НЕ выбрасывает наружу.
// Без IO, сети, Date.now() — только чистая логика изоляции.
//
// Публичный API:
//   runIsolated(items, taskFn, opts)  — последовательный прогон набора задач с изоляцией.
//   runIsolatedTask(taskFn, ...args)  — обёртка одного вызова.
//   isStopRequested(flags)            — чистая проверка флагов остановки (без IO).

/**
 * Прогоняет каждый элемент через taskFn ПОСЛЕДОВАТЕЛЬНО, изолируя сбои.
 * Один упавший элемент не прерывает остальные и не выбрасывает ошибку наружу.
 *
 * @param {Array} items   — массив входных данных; не-массив трактуется как [].
 * @param {Function} taskFn — async/sync функция (item, index) => value.
 *                            Если не функция — каждый элемент падает с Error('taskFn is not a function'),
 *                            но наружу ошибка не пробрасывается.
 * @param {object} [opts={}]
 * @param {Function} [opts.onError] — опциональный best-effort колбэк (error, item, index).
 *                                    Если сам бросает — проглатывается.
 * @returns {Promise<{ results: Array, succeeded: number, failed: number, total: number }>}
 */
export async function runIsolated(items, taskFn, opts = {}) {
  const safeItems = Array.isArray(items) ? items : [];
  const onError = typeof opts?.onError === 'function' ? opts.onError : null;

  const results = [];

  for (let index = 0; index < safeItems.length; index++) {
    const item = safeItems[index];

    if (typeof taskFn !== 'function') {
      results.push({ item, index, ok: false, error: new Error('taskFn is not a function') });
      continue;
    }

    try {
      const value = await taskFn(item, index);
      results.push({ item, index, ok: true, value });
    } catch (error) {
      results.push({ item, index, ok: false, error });
      if (onError !== null) {
        try {
          await onError(error, item, index);
        } catch (_) {
          // Изоляция логгера: сбой onError не роняет прогон.
        }
      }
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;

  return { results, succeeded, failed, total: results.length };
}

/**
 * Обёртка одного вызова taskFn для разовых шагов демона.
 * Никогда не выбрасывает — сбой отражается в возвращаемом объекте.
 *
 * @param {Function} taskFn — вызываемая функция.
 * @param {...*} args       — аргументы для taskFn.
 * @returns {Promise<{ ok: true, value: * } | { ok: false, error: Error }>}
 */
export async function runIsolatedTask(taskFn, ...args) {
  if (typeof taskFn !== 'function') {
    return { ok: false, error: new Error('taskFn is not a function') };
  }

  try {
    const value = await taskFn(...args);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Чистая проверка флагов остановки демона — без IO.
 * Фактическое чтение STOP-файла и обработку сигналов выполняет вызывающий;
 * здесь только решение на основе уже готовых булевых флагов.
 *
 * @param {{ stopFileExists?: boolean, signalReceived?: boolean }} [flags={}]
 * @returns {boolean} — true если любой флаг === true.
 */
export function isStopRequested(flags = {}) {
  if (flags === null || typeof flags !== 'object' || Array.isArray(flags)) return false;
  return flags.stopFileExists === true || flags.signalReceived === true;
}
