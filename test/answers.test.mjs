import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeEmployerVoice, matchesAnyPattern, optionMatches } from '../src/lib/answers.js';

// --- looksLikeEmployerVoice ---

test('looksLikeEmployerVoice: "ваш опыт релевантен" → true', () => {
  assert.equal(looksLikeEmployerVoice('Ваш опыт релевантен нашим задачам'), true);
});

test('looksLikeEmployerVoice: "готовы пригласить" (мн.ч.) → true', () => {
  assert.equal(looksLikeEmployerVoice('Готовы пригласить вас на собеседование'), true);
});

test('looksLikeEmployerVoice: "готова пригласить" (жен.) → true', () => {
  assert.equal(looksLikeEmployerVoice('Готова пригласить'), true);
});

test('looksLikeEmployerVoice: "мы пригласим" → true', () => {
  assert.equal(looksLikeEmployerVoice('мы пригласим вас'), true);
});

test('looksLikeEmployerVoice: "рассмотрим вашу кандидатуру" → true', () => {
  assert.equal(looksLikeEmployerVoice('рассмотрим вашу кандидатуру в ближайшее время'), true);
});

test('looksLikeEmployerVoice: "подходите нашей компании" → true', () => {
  assert.equal(looksLikeEmployerVoice('Вы подходите нашей компании'), true);
});

test('looksLikeEmployerVoice: "приглашаем вас" → true', () => {
  assert.equal(looksLikeEmployerVoice('Приглашаем вас на интервью'), true);
});

test('looksLikeEmployerVoice: "будем рады пригласить" → true', () => {
  assert.equal(looksLikeEmployerVoice('будем рады пригласить вас'), true);
});

test('looksLikeEmployerVoice: кандидатский голос → false', () => {
  assert.equal(looksLikeEmployerVoice('Есть практический опыт с Kubernetes и CI/CD.'), false);
});

// --- optionMatches ---

test('optionMatches: одинаковые строки с разным регистром и пробелами → true', () => {
  assert.equal(optionMatches('Да', '  да '), true);
});

test('optionMatches: разные строки → false', () => {
  assert.equal(optionMatches('Да', 'Нет'), false);
});

// --- matchesAnyPattern ---

test('matchesAnyPattern: хотя бы один паттерн совпадает → true', () => {
  assert.equal(matchesAnyPattern('пройти тест здесь', [/пройти тест/i, /другое/i]), true);
});

test('matchesAnyPattern: ни один паттерн не совпадает → false', () => {
  assert.equal(matchesAnyPattern('обычный текст', [/пройти тест/i, /тестовое задание/i]), false);
});

test('matchesAnyPattern: пустой массив паттернов → false', () => {
  assert.equal(matchesAnyPattern('любой текст', []), false);
});
