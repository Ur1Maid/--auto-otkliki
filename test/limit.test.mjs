import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMIT_PATTERNS, isLimitReached } from '../src/lib/limit.js';

// --- LIMIT_PATTERNS экспортируется ---

test('LIMIT_PATTERNS: экспортируется и является непустым массивом', () => {
  assert.ok(Array.isArray(LIMIT_PATTERNS));
  assert.ok(LIMIT_PATTERNS.length > 0);
});

// --- isLimitReached: true на каждой сид-формулировке ---

test('isLimitReached: "максимальное количество вакансий" → true', () => {
  assert.equal(isLimitReached('Вы откликнулись на максимальное количество вакансий сегодня'), true);
});

test('isLimitReached: "лимит откликов исчерпан" → true', () => {
  assert.equal(isLimitReached('Лимит откликов исчерпан'), true);
});

test('isLimitReached: "достигли лимита откликов" → true', () => {
  assert.equal(isLimitReached('Вы достигли лимита откликов на сегодня'), true);
});

test('isLimitReached: "сегодня больше нельзя откликаться" → true', () => {
  assert.equal(isLimitReached('К сожалению, сегодня больше нельзя откликаться'), true);
});

test('isLimitReached: "исчерпан дневной лимит откликов" → true', () => {
  assert.equal(isLimitReached('Исчерпан дневной лимит откликов'), true);
});

test('isLimitReached: "превышен лимит откликов" → true', () => {
  assert.equal(isLimitReached('Превышен лимит откликов'), true);
});

test('isLimitReached: регистронезависимость — все заглавные → true', () => {
  assert.equal(isLimitReached('ЛИМИТ ОТКЛИКОВ ИСЧЕРПАН'), true);
});

// --- isLimitReached: false на нейтральном тексте ---

test('isLimitReached: нейтральный текст вакансии → false', () => {
  assert.equal(isLimitReached('Senior DevOps Engineer, Москва, опыт от 3 лет, Docker, Kubernetes'), false);
});

test('isLimitReached: "Откликнуться" на странице вакансии → false', () => {
  assert.equal(isLimitReached('Откликнуться на вакансию'), false);
});

// --- isLimitReached: false на плохих входных данных (never-throws) ---

test('isLimitReached: пустая строка → false', () => {
  assert.equal(isLimitReached(''), false);
});

test('isLimitReached: null → false', () => {
  assert.equal(isLimitReached(null), false);
});

test('isLimitReached: undefined → false', () => {
  assert.equal(isLimitReached(undefined), false);
});

test('isLimitReached: число → false', () => {
  assert.equal(isLimitReached(42), false);
});

test('isLimitReached: объект → false', () => {
  assert.equal(isLimitReached({ text: 'лимит откликов исчерпан' }), false);
});
