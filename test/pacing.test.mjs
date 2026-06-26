import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomDelayMs } from '../src/lib/pacing.js';

test('randomDelayMs: rand=0 → нижняя граница', () => {
  assert.equal(randomDelayMs(20000, 90000, () => 0), 20000);
});

test('randomDelayMs: rand≈1 → верхняя граница (включительно)', () => {
  assert.equal(randomDelayMs(20000, 90000, () => 0.999999), 90000);
});

test('randomDelayMs: середина диапазона', () => {
  assert.equal(randomDelayMs(0, 100, () => 0.5), 50);
});

test('randomDelayMs: результат всегда в [min, max] на 1000 прогонов', () => {
  for (let i = 0; i < 1000; i++) {
    const v = randomDelayMs(20000, 90000);
    assert.ok(v >= 20000 && v <= 90000, `вне диапазона: ${v}`);
  }
});

test('randomDelayMs: перепутанные границы терпятся (swap)', () => {
  assert.equal(randomDelayMs(90000, 20000, () => 0), 20000);
});

test('randomDelayMs: некорректные входы → 0', () => {
  assert.equal(randomDelayMs(NaN, NaN, () => 0.5), 0);
  assert.equal(randomDelayMs(undefined, undefined, () => 0.5), 0);
});

test('randomDelayMs: min===max → ровно это значение', () => {
  assert.equal(randomDelayMs(5000, 5000, () => 0.5), 5000);
});
