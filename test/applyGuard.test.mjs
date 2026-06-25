import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSubmitAllowed } from '../src/lib/applyGuard.js';

// --- isSubmitAllowed: dry-run запрещает отправку ---

test('isSubmitAllowed: { dryRun: true } → false (отправка запрещена)', () => {
  assert.equal(isSubmitAllowed({ dryRun: true }), false);
});

// --- isSubmitAllowed: обычный режим разрешает отправку ---

test('isSubmitAllowed: { dryRun: false } → true', () => {
  assert.equal(isSubmitAllowed({ dryRun: false }), true);
});

test('isSubmitAllowed: {} (dryRun не передан) → true', () => {
  assert.equal(isSubmitAllowed({}), true);
});

test('isSubmitAllowed: без аргумента → true', () => {
  assert.equal(isSubmitAllowed(), true);
});

// --- isSubmitAllowed: строгое сравнение с true ---

test('isSubmitAllowed: { dryRun: "yes" } (не булево true) → true', () => {
  assert.equal(isSubmitAllowed({ dryRun: 'yes' }), true);
});

test('isSubmitAllowed: { dryRun: 1 } (не булево true) → true', () => {
  assert.equal(isSubmitAllowed({ dryRun: 1 }), true);
});
