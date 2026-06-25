import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runIsolated, runIsolatedTask, isStopRequested } from '../src/lib/isolate.js';

// Все тесты детерминированы: без реальных таймеров, Date.now(), IO или сети.

// --- runIsolated: все успешны ---

test('runIsolated: все элементы успешны → succeeded=N, failed=0, total=N', async () => {
  const items = [1, 2, 3];
  const { results, succeeded, failed, total } = await runIsolated(items, (x) => x * 10);
  assert.equal(succeeded, 3);
  assert.equal(failed, 0);
  assert.equal(total, 3);
  assert.equal(results.length, 3);
});

test('runIsolated: все успешны → ok:true и value корректны', async () => {
  const items = ['a', 'b', 'c'];
  const { results } = await runIsolated(items, (x) => x.toUpperCase());
  assert.equal(results[0].value, 'A');
  assert.equal(results[1].value, 'B');
  assert.equal(results[2].value, 'C');
});

test('runIsolated: все успешны → index проставлен корректно', async () => {
  const items = ['x', 'y', 'z'];
  const { results } = await runIsolated(items, (item, index) => index);
  assert.equal(results[0].index, 0);
  assert.equal(results[1].index, 1);
  assert.equal(results[2].index, 2);
});

// --- runIsolated: порядок results ---

test('runIsolated: порядок results соответствует порядку items', async () => {
  const items = [10, 20, 30];
  const { results } = await runIsolated(items, (x) => x);
  assert.equal(results[0].item, 10);
  assert.equal(results[1].item, 20);
  assert.equal(results[2].item, 30);
});

// --- runIsolated: ГЛАВНЫЙ ТЕСТ ЛОКАЛИЗАЦИИ — один сбой не прерывает остальные ---

test('runIsolated: один элемент бросает sync throw → остальные ВЫПОЛНЯЮТСЯ (локализация)', async () => {
  const items = [1, 2, 3];
  const { results, succeeded, failed, total } = await runIsolated(items, (x) => {
    if (x === 2) throw new Error('сбой на 2');
    return x * 100;
  });
  assert.equal(total, 3, 'все три обработаны');
  assert.equal(succeeded, 2, 'два успешны');
  assert.equal(failed, 1, 'один упал');
  // Первый и третий успешны
  assert.equal(results[0].ok, true);
  assert.equal(results[0].value, 100);
  assert.equal(results[2].ok, true);
  assert.equal(results[2].value, 300);
  // Второй — ошибка
  assert.equal(results[1].ok, false);
  assert.ok(results[1].error instanceof Error);
  assert.equal(results[1].error.message, 'сбой на 2');
});

test('runIsolated: один sync throw → ok:false у упавшего, item и index присутствуют', async () => {
  const items = ['ok1', 'boom', 'ok2'];
  const { results } = await runIsolated(items, (x) => {
    if (x === 'boom') throw new TypeError('взрыв');
    return x;
  });
  assert.equal(results[1].ok, false);
  assert.equal(results[1].item, 'boom');
  assert.equal(results[1].index, 1);
  assert.ok(results[1].error instanceof TypeError);
});

// --- runIsolated: async taskFn с rejected promise ---

test('runIsolated: async taskFn с rejected promise → изолируется так же', async () => {
  const items = ['a', 'fail', 'c'];
  const { results, succeeded, failed } = await runIsolated(items, async (x) => {
    if (x === 'fail') return Promise.reject(new Error('async сбой'));
    return x + '!';
  });
  assert.equal(succeeded, 2);
  assert.equal(failed, 1);
  assert.equal(results[1].ok, false);
  assert.equal(results[1].error.message, 'async сбой');
  assert.equal(results[0].value, 'a!');
  assert.equal(results[2].value, 'c!');
});

// --- runIsolated: taskFn не функция ---

test('runIsolated: taskFn не функция → все ok:false, без throw', async () => {
  const items = [1, 2, 3];
  const { results, succeeded, failed, total } = await runIsolated(items, 42);
  assert.equal(total, 3);
  assert.equal(succeeded, 0);
  assert.equal(failed, 3);
  for (const r of results) {
    assert.equal(r.ok, false);
    assert.ok(r.error instanceof Error);
    assert.equal(r.error.message, 'taskFn is not a function');
  }
});

test('runIsolated: taskFn = undefined → все ok:false, без throw', async () => {
  const { succeeded, failed } = await runIsolated([1, 2], undefined);
  assert.equal(succeeded, 0);
  assert.equal(failed, 2);
});

test('runIsolated: taskFn = null → все ok:false, без throw', async () => {
  const { failed } = await runIsolated(['x'], null);
  assert.equal(failed, 1);
});

// --- runIsolated: items не массив ---

test('runIsolated: items не массив (null) → пустой результат без throw', async () => {
  const { results, succeeded, failed, total } = await runIsolated(null, (x) => x);
  assert.equal(total, 0);
  assert.equal(succeeded, 0);
  assert.equal(failed, 0);
  assert.deepEqual(results, []);
});

test('runIsolated: items не массив (строка) → пустой результат без throw', async () => {
  const { total } = await runIsolated('abc', (x) => x);
  assert.equal(total, 0);
});

test('runIsolated: items не массив (число) → пустой результат без throw', async () => {
  const { total } = await runIsolated(42, (x) => x);
  assert.equal(total, 0);
});

test('runIsolated: items не массив (объект) → пустой результат без throw', async () => {
  const { total } = await runIsolated({ a: 1 }, (x) => x);
  assert.equal(total, 0);
});

test('runIsolated: items пустой массив → total=0 без throw', async () => {
  const { results, succeeded, failed, total } = await runIsolated([], (x) => x);
  assert.equal(total, 0);
  assert.equal(succeeded, 0);
  assert.equal(failed, 0);
  assert.deepEqual(results, []);
});

// --- runIsolated: onError ---

test('runIsolated: onError вызывается на сбоях с (error, item, index)', async () => {
  const calls = [];
  const items = [1, 2, 3];
  await runIsolated(
    items,
    (x) => {
      if (x === 2) throw new Error('ошибка');
      return x;
    },
    {
      onError: (err, item, index) => {
        calls.push({ message: err.message, item, index });
      },
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message, 'ошибка');
  assert.equal(calls[0].item, 2);
  assert.equal(calls[0].index, 1);
});

test('runIsolated: onError сам бросает → не роняет прогон, succeeded/failed корректны', async () => {
  const items = [1, 2, 3];
  const { succeeded, failed } = await runIsolated(
    items,
    (x) => {
      if (x === 2) throw new Error('бум');
      return x;
    },
    {
      onError: () => {
        throw new Error('onError тоже взорвался');
      },
    },
  );
  assert.equal(succeeded, 2);
  assert.equal(failed, 1);
});

test('runIsolated: onError не вызывается при успехе', async () => {
  let called = false;
  const items = [1, 2, 3];
  await runIsolated(items, (x) => x * 2, { onError: () => { called = true; } });
  assert.equal(called, false);
});

test('runIsolated: onError не функция → игнорируется, прогон не падает', async () => {
  const items = [1, 2];
  const { succeeded, failed } = await runIsolated(
    items,
    (x) => { if (x === 2) throw new Error('x'); return x; },
    { onError: 'не функция' },
  );
  assert.equal(succeeded, 1);
  assert.equal(failed, 1);
});

test('runIsolated: onError async и бросает → не роняет прогон', async () => {
  const items = ['fail'];
  const { failed } = await runIsolated(
    items,
    () => { throw new Error('задача'); },
    { onError: async () => { throw new Error('async onError сбой'); } },
  );
  assert.equal(failed, 1);
});

// --- runIsolated: item присутствует в results ---

test('runIsolated: item корректно сохраняется в каждом results-элементе', async () => {
  const items = [{ id: 1 }, { id: 2 }];
  const { results } = await runIsolated(items, (x) => x.id);
  assert.deepEqual(results[0].item, { id: 1 });
  assert.deepEqual(results[1].item, { id: 2 });
});

// --- runIsolatedTask: успех ---

test('runIsolatedTask: успех → { ok: true, value }', async () => {
  const result = await runIsolatedTask((a, b) => a + b, 3, 4);
  assert.equal(result.ok, true);
  assert.equal(result.value, 7);
});

test('runIsolatedTask: async taskFn успех → { ok: true, value }', async () => {
  const result = await runIsolatedTask(async (x) => x * 2, 21);
  assert.equal(result.ok, true);
  assert.equal(result.value, 42);
});

// --- runIsolatedTask: сбой ---

test('runIsolatedTask: sync throw → { ok: false, error } без throw', async () => {
  const result = await runIsolatedTask(() => { throw new RangeError('выход за диапазон'); });
  assert.equal(result.ok, false);
  assert.ok(result.error instanceof RangeError);
  assert.equal(result.error.message, 'выход за диапазон');
});

test('runIsolatedTask: async rejected promise → { ok: false, error } без throw', async () => {
  const result = await runIsolatedTask(async () => Promise.reject(new TypeError('async ошибка')));
  assert.equal(result.ok, false);
  assert.ok(result.error instanceof TypeError);
});

// --- runIsolatedTask: не функция ---

test('runIsolatedTask: taskFn не функция (число) → { ok: false, error } без throw', async () => {
  const result = await runIsolatedTask(123);
  assert.equal(result.ok, false);
  assert.ok(result.error instanceof Error);
  assert.equal(result.error.message, 'taskFn is not a function');
});

test('runIsolatedTask: taskFn не функция (null) → { ok: false, error } без throw', async () => {
  const result = await runIsolatedTask(null);
  assert.equal(result.ok, false);
  assert.ok(result.error instanceof Error);
});

test('runIsolatedTask: taskFn не функция (undefined) → { ok: false, error } без throw', async () => {
  const result = await runIsolatedTask(undefined);
  assert.equal(result.ok, false);
  assert.ok(result.error instanceof Error);
});

test('runIsolatedTask: taskFn не функция (строка) → { ok: false, error } без throw', async () => {
  const result = await runIsolatedTask('fn');
  assert.equal(result.ok, false);
  assert.ok(result.error instanceof Error);
});

// --- isStopRequested ---

test('isStopRequested: stopFileExists:true → true', () => {
  assert.equal(isStopRequested({ stopFileExists: true }), true);
});

test('isStopRequested: signalReceived:true → true', () => {
  assert.equal(isStopRequested({ signalReceived: true }), true);
});

test('isStopRequested: оба true → true', () => {
  assert.equal(isStopRequested({ stopFileExists: true, signalReceived: true }), true);
});

test('isStopRequested: оба false → false', () => {
  assert.equal(isStopRequested({ stopFileExists: false, signalReceived: false }), false);
});

test('isStopRequested: пустой объект → false', () => {
  assert.equal(isStopRequested({}), false);
});

test('isStopRequested: без аргумента (default {}) → false', () => {
  assert.equal(isStopRequested(), false);
});

test('isStopRequested: не-объект (строка) → false', () => {
  assert.equal(isStopRequested('stop'), false);
});

test('isStopRequested: не-объект (число) → false', () => {
  assert.equal(isStopRequested(42), false);
});

test('isStopRequested: null → false', () => {
  assert.equal(isStopRequested(null), false);
});

test('isStopRequested: массив → false (не plain-объект)', () => {
  assert.equal(isStopRequested([true, true]), false);
});

test('isStopRequested: stopFileExists:true, signalReceived:false → true (достаточно одного)', () => {
  assert.equal(isStopRequested({ stopFileExists: true, signalReceived: false }), true);
});

test('isStopRequested: stopFileExists:false, signalReceived:true → true (достаточно одного)', () => {
  assert.equal(isStopRequested({ stopFileExists: false, signalReceived: true }), true);
});

test('isStopRequested: truthy-но-не-true значения (число 1, строка) → false', () => {
  assert.equal(isStopRequested({ stopFileExists: 1 }), false);
  assert.equal(isStopRequested({ stopFileExists: 'yes' }), false);
  assert.equal(isStopRequested({ signalReceived: 1 }), false);
});
