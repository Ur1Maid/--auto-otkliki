import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverLetterRequired, shouldGenerateCoverLetter } from '../src/lib/coverLetter.js';

// --- coverLetterRequired ---

test('coverLetterRequired: явная фраза "Сопроводительное письмо обязательно" → true', () => {
  assert.equal(coverLetterRequired('Сопроводительное письмо обязательно для отклика'), true);
});

test('coverLetterRequired: вариант "сопроводительное письмо обязательное" → true', () => {
  assert.equal(coverLetterRequired('Добавьте сопроводительное письмо обязательное'), true);
});

test('coverLetterRequired: регистронезависимость — все заглавные → true', () => {
  assert.equal(coverLetterRequired('СОПРОВОДИТЕЛЬНОЕ ПИСЬМО ОБЯЗАТЕЛЬ НО'), true);
});

test('coverLetterRequired: текст без нужной фразы → false', () => {
  assert.equal(coverLetterRequired('Заполните анкету и нажмите Откликнуться'), false);
});

test('coverLetterRequired: пустая строка → false', () => {
  assert.equal(coverLetterRequired(''), false);
});

test('coverLetterRequired: null → false', () => {
  assert.equal(coverLetterRequired(null), false);
});

test('coverLetterRequired: undefined → false', () => {
  assert.equal(coverLetterRequired(undefined), false);
});

test('coverLetterRequired: число → false', () => {
  assert.equal(coverLetterRequired(42), false);
});

// --- shouldGenerateCoverLetter ---

test('shouldGenerateCoverLetter: required=true → true (любой score)', () => {
  assert.equal(shouldGenerateCoverLetter({ required: true }), true);
  assert.equal(shouldGenerateCoverLetter({ required: true, score: 0, minScore: 90 }), true);
  assert.equal(shouldGenerateCoverLetter({ required: true, score: 100, minScore: 50 }), true);
});

test('shouldGenerateCoverLetter: required=false без порога → false', () => {
  assert.equal(shouldGenerateCoverLetter({ required: false }), false);
});

test('shouldGenerateCoverLetter: required=false, score >= minScore → true', () => {
  assert.equal(shouldGenerateCoverLetter({ required: false, score: 85, minScore: 80 }), true);
  assert.equal(shouldGenerateCoverLetter({ required: false, score: 80, minScore: 80 }), true);
});

test('shouldGenerateCoverLetter: required=false, score < minScore → false', () => {
  assert.equal(shouldGenerateCoverLetter({ required: false, score: 79, minScore: 80 }), false);
  assert.equal(shouldGenerateCoverLetter({ required: false, score: 0, minScore: 50 }), false);
});

test('shouldGenerateCoverLetter: required=false, нечисловые score/minScore → false', () => {
  assert.equal(shouldGenerateCoverLetter({ required: false, score: 'высокий', minScore: 80 }), false);
  assert.equal(shouldGenerateCoverLetter({ required: false, score: 90, minScore: NaN }), false);
  assert.equal(shouldGenerateCoverLetter({ required: false, score: null, minScore: null }), false);
});

test('shouldGenerateCoverLetter: вызов без аргументов → false', () => {
  assert.equal(shouldGenerateCoverLetter(), false);
});
