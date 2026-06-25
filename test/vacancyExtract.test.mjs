import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRequirements } from '../src/lib/vacancyExtract.js';

// --- extractRequirements ---

test('extractRequirements: начинает с маркера, отбрасывая вводный текст о компании', () => {
  const input = 'Мы отличная компания на рынке 20 лет. Офис в центре. Требования: опыт Linux от 3 лет, знание Bash.';
  const result = extractRequirements(input);
  assert.ok(result.startsWith('Требования'), 'результат должен начинаться с маркера «Требования»');
  assert.ok(!result.includes('Мы отличная компания'), 'вводный текст о компании должен быть отброшен');
});

test('extractRequirements: маркер «Обязанности» тоже распознаётся', () => {
  const input = 'Описание вакансии. Обязанности: деплой сервисов, настройка CI/CD.';
  const result = extractRequirements(input);
  assert.ok(result.startsWith('Обязанности'), 'результат должен начинаться с «Обязанности»');
});

test('extractRequirements: без маркера — возвращает первые maxLen символов', () => {
  const input = 'Без маркеров раздела. Обычный текст вакансии без явных блоков.';
  const result = extractRequirements(input, 20);
  assert.equal(result, input.slice(0, 20).trim());
});

test('extractRequirements: результат никогда не превышает maxLen символов', () => {
  const long = 'Требования: ' + 'x'.repeat(3000);
  const result = extractRequirements(long, 1500);
  assert.ok(result.length <= 1500, `длина ${result.length} превышает maxLen=1500`);
});

test('extractRequirements: пустая строка → «»', () => {
  assert.equal(extractRequirements(''), '');
});

test('extractRequirements: строка из пробелов → «»', () => {
  assert.equal(extractRequirements('   \n  \t  '), '');
});

test('extractRequirements: выбирает самый ранний из нескольких маркеров', () => {
  // «Обязанности» стоит раньше, чем «Требования»
  const input = 'Описание. Обязанности: писать код. Требования: знание Python.';
  const result = extractRequirements(input);
  assert.ok(result.startsWith('Обязанности'), 'должен начать с более раннего маркера «Обязанности»');
});

test('extractRequirements: поиск маркера нечувствителен к регистру', () => {
  const input = 'Раздел компании. ТРЕБОВАНИЯ: опыт с Docker.';
  const result = extractRequirements(input);
  assert.ok(result.toUpperCase().startsWith('ТРЕБОВАНИЯ'), 'маркер должен находиться без учёта регистра');
});
