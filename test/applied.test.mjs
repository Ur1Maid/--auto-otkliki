import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPLIED_PATTERNS, isAlreadyApplied } from '../src/lib/applied.js';

// --- APPLIED_PATTERNS экспортируется ---

test('APPLIED_PATTERNS: экспортируется и является непустым массивом', () => {
  assert.ok(Array.isArray(APPLIED_PATTERNS));
  assert.ok(APPLIED_PATTERNS.length > 0);
});

// --- isAlreadyApplied: true на каждой из 5 фраз ---

test('isAlreadyApplied: "Отклик отправлен" → true', () => {
  assert.equal(isAlreadyApplied('Отклик отправлен'), true);
});

test('isAlreadyApplied: "Резюме отправлено" → true', () => {
  assert.equal(isAlreadyApplied('Ваше резюме отправлено работодателю'), true);
});

test('isAlreadyApplied: "Вы откликнулись" → true', () => {
  assert.equal(isAlreadyApplied('Вы откликнулись на эту вакансию'), true);
});

test('isAlreadyApplied: "Отклик уже отправлен" → true', () => {
  assert.equal(isAlreadyApplied('Отклик уже отправлен'), true);
});

test('isAlreadyApplied: "Работодатель получит" → true', () => {
  assert.equal(isAlreadyApplied('Работодатель получит ваш отклик и резюме'), true);
});

test('isAlreadyApplied: регистронезависимость — все заглавные → true', () => {
  assert.equal(isAlreadyApplied('ОТКЛИК ОТПРАВЛЕН'), true);
});

// --- isAlreadyApplied: false на нейтральном тексте ---

test('isAlreadyApplied: нейтральный текст вакансии → false', () => {
  assert.equal(isAlreadyApplied('Senior DevOps Engineer, Москва, опыт от 3 лет, Docker, Kubernetes'), false);
});

// --- isAlreadyApplied: false на плохих входных данных ---

test('isAlreadyApplied: пустая строка → false', () => {
  assert.equal(isAlreadyApplied(''), false);
});

test('isAlreadyApplied: null → false', () => {
  assert.equal(isAlreadyApplied(null), false);
});

test('isAlreadyApplied: undefined → false', () => {
  assert.equal(isAlreadyApplied(undefined), false);
});

test('isAlreadyApplied: число → false', () => {
  assert.equal(isAlreadyApplied(42), false);
});
