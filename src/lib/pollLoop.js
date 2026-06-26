// Управление поллинг-циклом с инъекцией зависимостей (M4.7).
// Чистая логика цикла — без IO, без реальных таймеров, без браузера.
// Все нестабильные зависимости (sleep, shouldStop, iteration) инъектируются,
// что позволяет тестировать без реальных таймеров и Playwright.
//
// Публичный API:
//   runPollingLoop(opts) — запускает поллинг-цикл; возвращает { iterations, stoppedBy }.

import { runIsolatedTask } from './isolate.js';

/**
 * Запускает поллинг-цикл с изоляцией итераций и инъекцией зависимостей.
 *
 * @param {{
 *   iteration?: (index: number) => any,
 *   shouldStop?: () => boolean | Promise<boolean>,
 *   intervalMs?: number,
 *   sleep?: (ms: number) => Promise<void>,
 *   maxIterations?: number,
 * }} [opts]
 * @returns {Promise<{ iterations: number, stoppedBy: string }>}
 */
export async function runPollingLoop(opts = {}) {
  const {
    iteration,
    shouldStop,
    maxIterations,
  } = opts;

  // Нормализуем intervalMs: только конечные неотрицательные числа, иначе 0.
  const rawMs = opts.intervalMs;
  const intervalMs = Number.isFinite(rawMs) && rawMs >= 0 ? rawMs : 0;

  // Инъекция sleep: реальная по умолчанию, мок в тестах.
  const sleep = typeof opts.sleep === 'function'
    ? opts.sleep
    : (ms) => new Promise((r) => setTimeout(r, ms));

  // Наличие предохранителя.
  const hasMaxIter = Number.isFinite(maxIterations) && maxIterations > 0;

  let count = 0;
  let stoppedBy = 'max_iterations'; // дефолт если цикл завершился по maxIterations

  while (true) {
    // Проверка shouldStop ПЕРЕД итерацией (обёрнута в try/catch — ошибка = не стоп).
    if (typeof shouldStop === 'function') {
      let stop = false;
      try {
        stop = await shouldStop();
      } catch (_) {
        // Ошибка shouldStop трактуется как «не стоп» — цикл продолжается.
      }
      if (stop) {
        stoppedBy = 'stop_requested';
        break;
      }
    }

    // Проверка предохранителя перед итерацией.
    if (hasMaxIter && count >= maxIterations) {
      stoppedBy = 'max_iterations';
      break;
    }

    // Выполняем итерацию через runIsolatedTask — сбой не прерывает цикл.
    await runIsolatedTask(iteration, count);
    count++;

    // Проверка shouldStop ПОСЛЕ итерации (до сна — не спим, если уже стоп).
    if (typeof shouldStop === 'function') {
      let stop = false;
      try {
        stop = await shouldStop();
      } catch (_) {
        // Ошибка shouldStop трактуется как «не стоп».
      }
      if (stop) {
        stoppedBy = 'stop_requested';
        break;
      }
    }

    // Проверка предохранителя после итерации (до сна).
    if (hasMaxIter && count >= maxIterations) {
      stoppedBy = 'max_iterations';
      break;
    }

    await sleep(intervalMs);
  }

  return { iterations: count, stoppedBy };
}
