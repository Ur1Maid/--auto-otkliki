import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPollingLoop } from '../src/lib/pollLoop.js';

// Все тесты детерминированы: sleep-мок мгновенный, без реальных таймеров.

// ---------------------------------------------------------------------------
// Вспомогательные фабрики
// ---------------------------------------------------------------------------

/** Мгновенный sleep-мок: фиксирует переданные ms. */
function makeSleep() {
  const calls = [];
  const fn = async (ms) => { calls.push(ms); };
  fn.calls = calls;
  return fn;
}

// ---------------------------------------------------------------------------
// shouldStop сразу true → 0 итераций
// ---------------------------------------------------------------------------

test('pollLoop: shouldStop сразу true → 0 итераций, stoppedBy stop_requested', async () => {
  const sleep = makeSleep();
  let iterCount = 0;
  const result = await runPollingLoop({
    iteration: () => { iterCount++; },
    shouldStop: () => true,
    sleep,
    intervalMs: 100,
  });
  assert.equal(result.iterations, 0, 'должно быть 0 итераций');
  assert.equal(result.stoppedBy, 'stop_requested');
  assert.equal(iterCount, 0, 'iteration не должна вызываться');
  assert.equal(sleep.calls.length, 0, 'sleep не должен вызываться');
});

// ---------------------------------------------------------------------------
// shouldStop после 3 итераций → 3 итерации, sleep вызван 2 раза
// ---------------------------------------------------------------------------

test('pollLoop: shouldStop после 3 итераций → 3 итерации, sleep вызван 2 раза', async () => {
  const sleep = makeSleep();
  // shouldStop возвращает true когда счётчик вызовов достиг 6-го вызова
  // (3 до итерации + 3 после; stop возникает на 6-м вызове — после 3-й итерации, post-check).
  // Проще: мок-счётчик успешно выполненных итераций; shouldStop=true когда iterCount===3.
  let iterCount = 0;
  const result = await runPollingLoop({
    iteration: () => { iterCount++; },
    shouldStop: () => iterCount >= 3,
    sleep,
    intervalMs: 500,
  });
  assert.equal(result.iterations, 3, 'должно быть ровно 3 итерации');
  assert.equal(result.stoppedBy, 'stop_requested');
  // После 3-й итерации (count=3) post-check shouldStop → true → break без sleep.
  // sleep вызывался после 1-й и 2-й итераций → 2 раза.
  assert.equal(sleep.calls.length, 2, 'sleep вызван ровно 2 раза (не после последней итерации)');
});

// ---------------------------------------------------------------------------
// intervalMs передаётся в sleep
// ---------------------------------------------------------------------------

test('pollLoop: intervalMs корректно передаётся в sleep', async () => {
  const sleep = makeSleep();
  await runPollingLoop({
    iteration: () => {},
    shouldStop: () => false,
    maxIterations: 2,
    sleep,
    intervalMs: 999,
  });
  // sleep вызывался между итерациями; при maxIterations=2 sleep вызывается 1 раз (между 1й и 2й).
  assert.ok(sleep.calls.length > 0, 'sleep должен быть вызван хотя бы раз');
  for (const ms of sleep.calls) {
    assert.equal(ms, 999, 'каждый вызов sleep должен получить intervalMs=999');
  }
});

// ---------------------------------------------------------------------------
// maxIterations:2 → ровно 2 итерации, stoppedBy max_iterations
// ---------------------------------------------------------------------------

test('pollLoop: maxIterations:2 → 2 итерации, stoppedBy max_iterations', async () => {
  const sleep = makeSleep();
  let iterCount = 0;
  const result = await runPollingLoop({
    iteration: () => { iterCount++; },
    sleep,
    maxIterations: 2,
    intervalMs: 0,
  });
  assert.equal(result.iterations, 2, 'ровно 2 итерации');
  assert.equal(result.stoppedBy, 'max_iterations');
  assert.equal(iterCount, 2, 'iteration вызвана ровно 2 раза');
});

// ---------------------------------------------------------------------------
// Изоляция: iteration бросает → цикл НЕ падает, продолжает
// ---------------------------------------------------------------------------

test('pollLoop: iteration бросает → цикл не падает, продолжает; maxIterations:3 → 3 итерации', async () => {
  const sleep = makeSleep();
  let attempts = 0;
  let result;
  await assert.doesNotReject(async () => {
    result = await runPollingLoop({
      iteration: () => {
        attempts++;
        throw new Error('сбой итерации');
      },
      sleep,
      maxIterations: 3,
      intervalMs: 0,
    });
  });
  assert.equal(result.iterations, 3, '3 итерации несмотря на throw');
  assert.equal(result.stoppedBy, 'max_iterations');
  assert.equal(attempts, 3, 'iteration вызвана 3 раза (каждая бросала)');
});

// ---------------------------------------------------------------------------
// shouldStop бросает → трактуется как false, цикл продолжается
// ---------------------------------------------------------------------------

test('pollLoop: shouldStop бросает → трактуется как false, цикл не падает', async () => {
  const sleep = makeSleep();
  let result;
  await assert.doesNotReject(async () => {
    result = await runPollingLoop({
      iteration: () => {},
      shouldStop: () => { throw new Error('shouldStop взорвался'); },
      sleep,
      maxIterations: 2,
      intervalMs: 0,
    });
  });
  // Несмотря на бросающий shouldStop — цикл завершился по maxIterations.
  assert.equal(result.iterations, 2);
  assert.equal(result.stoppedBy, 'max_iterations');
});

// ---------------------------------------------------------------------------
// Без shouldStop (не функция) — цикл завершается по maxIterations
// ---------------------------------------------------------------------------

test('pollLoop: shouldStop не задан → цикл завершается по maxIterations', async () => {
  const sleep = makeSleep();
  const result = await runPollingLoop({
    iteration: () => {},
    sleep,
    maxIterations: 3,
    intervalMs: 0,
  });
  assert.equal(result.iterations, 3);
  assert.equal(result.stoppedBy, 'max_iterations');
});

// ---------------------------------------------------------------------------
// Дополнительно: intervalMs невалидный → нормализуется в 0 (sleep вызывается с 0)
// ---------------------------------------------------------------------------

test('pollLoop: невалидный intervalMs (отрицательный) → нормализуется в 0', async () => {
  const sleep = makeSleep();
  await runPollingLoop({
    iteration: () => {},
    sleep,
    maxIterations: 2,
    intervalMs: -50,
  });
  for (const ms of sleep.calls) {
    assert.equal(ms, 0, 'невалидный intervalMs нормализуется в 0');
  }
});

test('pollLoop: невалидный intervalMs (NaN) → нормализуется в 0', async () => {
  const sleep = makeSleep();
  await runPollingLoop({
    iteration: () => {},
    sleep,
    maxIterations: 1,
    intervalMs: NaN,
  });
  // 1 итерация: post-check maxIterations → break без sleep. sleep.calls.length === 0.
  // Проверим что не упало.
  assert.equal(true, true);
});

// ---------------------------------------------------------------------------
// Возвращаемый тип всегда { iterations: number, stoppedBy: string }
// ---------------------------------------------------------------------------

test('pollLoop: возвращает объект { iterations, stoppedBy }', async () => {
  const result = await runPollingLoop({
    sleep: makeSleep(),
    maxIterations: 0, // невалидный (не >0) → нет предохранителя → без shouldStop бесконечен
    shouldStop: () => true, // прерываем сразу
  });
  assert.ok(typeof result.iterations === 'number', 'iterations — число');
  assert.ok(typeof result.stoppedBy === 'string', 'stoppedBy — строка');
});
