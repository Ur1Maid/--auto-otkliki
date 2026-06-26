import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_MANUAL_PATTERNS,
  RESPONSE_BUTTON_TEXTS,
  APPLICATION_FLOW_BUTTON_TEXTS,
  APPLIED_PATTERNS,
} from '../src/lib/selectors.js';

// --- Экспорт и тип ---

test('REQUIRED_MANUAL_PATTERNS: экспортируется и является непустым массивом RegExp', () => {
  assert.ok(Array.isArray(REQUIRED_MANUAL_PATTERNS));
  assert.ok(REQUIRED_MANUAL_PATTERNS.length > 0);
  for (const p of REQUIRED_MANUAL_PATTERNS) assert.ok(p instanceof RegExp, `не RegExp: ${p}`);
});

test('RESPONSE_BUTTON_TEXTS: экспортируется и является непустым массивом RegExp', () => {
  assert.ok(Array.isArray(RESPONSE_BUTTON_TEXTS));
  assert.ok(RESPONSE_BUTTON_TEXTS.length > 0);
  for (const p of RESPONSE_BUTTON_TEXTS) assert.ok(p instanceof RegExp, `не RegExp: ${p}`);
});

test('APPLICATION_FLOW_BUTTON_TEXTS: экспортируется и является непустым массивом RegExp', () => {
  assert.ok(Array.isArray(APPLICATION_FLOW_BUTTON_TEXTS));
  assert.ok(APPLICATION_FLOW_BUTTON_TEXTS.length > 0);
  for (const p of APPLICATION_FLOW_BUTTON_TEXTS) assert.ok(p instanceof RegExp, `не RegExp: ${p}`);
});

test('APPLIED_PATTERNS: re-export из selectors.js, непустой массив RegExp', () => {
  assert.ok(Array.isArray(APPLIED_PATTERNS));
  assert.ok(APPLIED_PATTERNS.length > 0);
  for (const p of APPLIED_PATTERNS) assert.ok(p instanceof RegExp, `не RegExp: ${p}`);
});

// --- Фиксируем количества (чтобы случайно не потерять паттерн) ---

test('REQUIRED_MANUAL_PATTERNS: ровно 6 паттернов', () => {
  assert.strictEqual(REQUIRED_MANUAL_PATTERNS.length, 6);
});

test('RESPONSE_BUTTON_TEXTS: ровно 2 паттерна', () => {
  assert.strictEqual(RESPONSE_BUTTON_TEXTS.length, 2);
});

test('APPLICATION_FLOW_BUTTON_TEXTS: ровно 9 паттернов', () => {
  assert.strictEqual(APPLICATION_FLOW_BUTTON_TEXTS.length, 9);
});

// --- Якорные матчи RESPONSE_BUTTON_TEXTS ---

test('RESPONSE_BUTTON_TEXTS: матчит "Откликнуться"', () => {
  assert.ok(RESPONSE_BUTTON_TEXTS.some((r) => r.test('Откликнуться')));
});

test('RESPONSE_BUTTON_TEXTS: матчит "Откликнуться на вакансию"', () => {
  assert.ok(RESPONSE_BUTTON_TEXTS.some((r) => r.test('Откликнуться на вакансию')));
});

test('RESPONSE_BUTTON_TEXTS: не матчит подстроку без якоря ("Откликнуться на работу")', () => {
  assert.ok(!RESPONSE_BUTTON_TEXTS.some((r) => r.test('Откликнуться на работу')));
});

// --- Якорные матчи APPLICATION_FLOW_BUTTON_TEXTS ---

test('APPLICATION_FLOW_BUTTON_TEXTS: матчит "Отправить"', () => {
  assert.ok(APPLICATION_FLOW_BUTTON_TEXTS.some((r) => r.test('Отправить')));
});

test('APPLICATION_FLOW_BUTTON_TEXTS: матчит "Продолжить"', () => {
  assert.ok(APPLICATION_FLOW_BUTTON_TEXTS.some((r) => r.test('Продолжить')));
});

test('APPLICATION_FLOW_BUTTON_TEXTS: матчит "Выбрать резюме"', () => {
  assert.ok(APPLICATION_FLOW_BUTTON_TEXTS.some((r) => r.test('Выбрать резюме')));
});

// --- Якорные матчи REQUIRED_MANUAL_PATTERNS ---

test('REQUIRED_MANUAL_PATTERNS: матчит "Пройти тест"', () => {
  assert.ok(REQUIRED_MANUAL_PATTERNS.some((r) => r.test('Пройти тест')));
});

test('REQUIRED_MANUAL_PATTERNS: матчит "Ответ обязателен"', () => {
  assert.ok(REQUIRED_MANUAL_PATTERNS.some((r) => r.test('Ответ обязателен')));
});

test('REQUIRED_MANUAL_PATTERNS: матчит "тестовое задание"', () => {
  assert.ok(REQUIRED_MANUAL_PATTERNS.some((r) => r.test('тестовое задание')));
});

test('REQUIRED_MANUAL_PATTERNS: матчит "тестовое задания" (форма род. падежа)', () => {
  assert.ok(REQUIRED_MANUAL_PATTERNS.some((r) => r.test('тестовое задания')));
});

// --- Якорный матч APPLIED_PATTERNS (re-export) ---

test('APPLIED_PATTERNS (re-export): матчит "Вы откликнулись"', () => {
  assert.ok(APPLIED_PATTERNS.some((r) => r.test('Вы откликнулись')));
});

test('APPLIED_PATTERNS (re-export): матчит "Отклик отправлен"', () => {
  assert.ok(APPLIED_PATTERNS.some((r) => r.test('Отклик отправлен')));
});
