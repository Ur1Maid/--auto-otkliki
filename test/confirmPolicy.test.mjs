import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfirmPolicy } from '../src/lib/confirmPolicy.js';

// Все тесты детерминированы: чистая функция, без реального process/stdin.

test('resolveConfirmPolicy: матрица isTTY × autoFlag', () => {
  // autoFlag главенствует над TTY → 'auto'
  assert.equal(resolveConfirmPolicy({ isTTY: true, autoFlag: true }), 'auto');
  assert.equal(resolveConfirmPolicy({ isTTY: false, autoFlag: true }), 'auto');
  // нет autoFlag, есть TTY → 'prompt'
  assert.equal(resolveConfirmPolicy({ isTTY: true, autoFlag: false }), 'prompt');
  // нет autoFlag, нет TTY → безопасный 'decline' (не виснуть)
  assert.equal(resolveConfirmPolicy({ isTTY: false, autoFlag: false }), 'decline');
});

test('resolveConfirmPolicy: дефолт без аргумента → decline', () => {
  assert.equal(resolveConfirmPolicy(), 'decline');
  assert.equal(resolveConfirmPolicy({}), 'decline');
});

test('resolveConfirmPolicy: undefined-поля трактуются как false', () => {
  assert.equal(resolveConfirmPolicy({ isTTY: undefined, autoFlag: undefined }), 'decline');
  assert.equal(resolveConfirmPolicy({ isTTY: true }), 'prompt');
  assert.equal(resolveConfirmPolicy({ autoFlag: true }), 'auto');
});

test('resolveConfirmPolicy: truthy/falsy значения нормализуются по поведению', () => {
  // autoFlag truthy → auto независимо от TTY
  assert.equal(resolveConfirmPolicy({ isTTY: 0, autoFlag: 1 }), 'auto');
  // autoFlag falsy, isTTY truthy → prompt
  assert.equal(resolveConfirmPolicy({ isTTY: 1, autoFlag: 0 }), 'prompt');
  // оба falsy → decline
  assert.equal(resolveConfirmPolicy({ isTTY: 0, autoFlag: 0 }), 'decline');
});
