import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFieldKind, getMainQuestion, isGenericFieldContext, isSalaryContext } from '../src/lib/fields.js';

// --- detectFieldKind ---

test('detectFieldKind: контекст "зарплата" → salary', () => {
  assert.equal(detectFieldKind('зарплата'), 'salary');
});

test('detectFieldKind: контекст "salary" → salary', () => {
  assert.equal(detectFieldKind('salary'), 'salary');
});

test('detectFieldKind: контекст "оклад" → salary', () => {
  assert.equal(detectFieldKind('оклад'), 'salary');
});

test('detectFieldKind: контекст "Сопроводительное письмо" → coverLetter', () => {
  assert.equal(detectFieldKind('Сопроводительное письмо'), 'coverLetter');
});

test('detectFieldKind: cover letter через pageText → coverLetter', () => {
  assert.equal(detectFieldKind('text', 'cover letter'), 'coverLetter');
});

test('detectFieldKind: контекст "text" → unknown', () => {
  assert.equal(detectFieldKind('text'), 'unknown');
});

test('detectFieldKind: контекст "textarea" → unknown', () => {
  assert.equal(detectFieldKind('textarea'), 'unknown');
});

test('detectFieldKind: контекст "без контекста" → unknown', () => {
  assert.equal(detectFieldKind('без контекста'), 'unknown');
});

test('detectFieldKind: реальный вопрос → answer', () => {
  assert.equal(detectFieldKind('Ваш опыт с Kubernetes?'), 'answer');
});

test('detectFieldKind: salary проверяется раньше coverLetter (оба слова в контексте) → salary', () => {
  assert.equal(detectFieldKind('зарплата и сопроводительное письмо'), 'salary');
});

// --- isSalaryContext ---

test('isSalaryContext: зарплатный контекст → true', () => {
  assert.equal(isSalaryContext('ожидаемый оклад'), true);
});

test('isSalaryContext: обычный контекст → false', () => {
  assert.equal(isSalaryContext('Ваш опыт?'), false);
});

// --- isGenericFieldContext ---

test('isGenericFieldContext: "text" → true', () => {
  assert.equal(isGenericFieldContext('text'), true);
});

test('isGenericFieldContext: "  textarea  " (с пробелами) → true', () => {
  assert.equal(isGenericFieldContext('  textarea  '), true);
});

test('isGenericFieldContext: "без контекста" → true', () => {
  assert.equal(isGenericFieldContext('без контекста'), true);
});

test('isGenericFieldContext: "INPUT" (верхний регистр) → true', () => {
  assert.equal(isGenericFieldContext('INPUT'), true);
});

test('isGenericFieldContext: реальный текст → false', () => {
  assert.equal(isGenericFieldContext('Укажите ваш стаж'), false);
});

// --- getMainQuestion ---

test('getMainQuestion: возвращает первую непустую строку', () => {
  assert.equal(getMainQuestion('Первый вопрос\nВторой вопрос'), 'Первый вопрос');
});

test('getMainQuestion: фильтрует строки task_N_text', () => {
  assert.equal(getMainQuestion('task_1_text\nВаш опыт?'), 'Ваш опыт?');
});

test('getMainQuestion: task_N_text нечувствителен к регистру', () => {
  assert.equal(getMainQuestion('TASK_42_TEXT\nВопрос'), 'Вопрос');
});

test('getMainQuestion: пустой/пробельный контекст → "без контекста"', () => {
  assert.equal(getMainQuestion(''), 'без контекста');
  assert.equal(getMainQuestion('   \n  '), 'без контекста');
});

test('getMainQuestion: контекст только из task_N_text → "без контекста"', () => {
  assert.equal(getMainQuestion('task_1_text\ntask_2_text'), 'без контекста');
});
