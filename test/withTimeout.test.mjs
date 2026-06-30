import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout } from '../src/lib/withTimeout.js';

// Промис, который никогда не оседает — для проверки таймаут-ветки без висящих таймеров.
const never = () => new Promise(() => {});

test('резолвится значением промиса, если он успел до таймаута', async () => {
  const result = await withTimeout(Promise.resolve('ok'), 1000, 'TO');
  assert.equal(result, 'ok');
});

test('резолвится onTimeoutValue при превышении таймаута (не бросает)', async () => {
  const result = await withTimeout(never(), 10, 'TO');
  assert.equal(result, 'TO');
});

test('onTimeoutValue по умолчанию — undefined', async () => {
  const result = await withTimeout(never(), 10);
  assert.equal(result, undefined);
});

test('отклонение промиса до таймаута пробрасывается наружу', async () => {
  await assert.rejects(
    () => withTimeout(Promise.reject(new Error('boom')), 1000, 'TO'),
    /boom/,
  );
});

test('ms <= 0 → гонки нет, возвращается значение промиса', async () => {
  assert.equal(await withTimeout(Promise.resolve('v'), 0, 'TO'), 'v');
  assert.equal(await withTimeout(Promise.resolve('v'), -5, 'TO'), 'v');
});

test('ms не число → гонки нет, возвращается значение промиса', async () => {
  assert.equal(await withTimeout(Promise.resolve('v'), NaN, 'TO'), 'v');
  assert.equal(await withTimeout(Promise.resolve('v'), Infinity, 'TO'), 'v');
  assert.equal(await withTimeout(Promise.resolve('v'), undefined, 'TO'), 'v');
});

test('без гонки (ms<=0) отклонение тоже пробрасывается', async () => {
  await assert.rejects(() => withTimeout(Promise.reject(new Error('x')), 0, 'TO'), /x/);
});

test('не-промис значение оборачивается и резолвится', async () => {
  assert.equal(await withTimeout('plain', 1000, 'TO'), 'plain');
});

test('таймаут резолвит дефолтным значением даже когда промис позже отклонится', async () => {
  // Промис отклоняется ПОСЛЕ таймаута — наружу уходит onTimeoutValue, без unhandled rejection.
  const slow = new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 50));
  const result = await withTimeout(slow, 10, 'TO');
  assert.equal(result, 'TO');
  // Дать «позднему» отклонению осесть: оно проглочено гонкой, процесс не падает.
  await new Promise((r) => setTimeout(r, 60));
});
