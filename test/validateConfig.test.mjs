import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/lib/validateConfig.js';

// --- всё заполнено → ok, без ошибок и предупреждений ---

test('validateConfig: всё заполнено → ok:true, errors:[], warnings:[]', () => {
  const result = validateConfig({
    apiKey: 'sk-test-key',
    resume: 'Опытный DevOps-инженер',
    salary: 'от 150 000 ₽',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

// --- пустой apiKey → ошибка про DEEPSEEK_API_KEY ---

test('validateConfig: пустой apiKey → ok:false, ошибка про DEEPSEEK_API_KEY', () => {
  const result = validateConfig({ apiKey: '', resume: 'резюме', salary: 'зарплата' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0, 'ожидали хотя бы одну ошибку');
  assert.ok(
    result.errors.some((e) => e.includes('DEEPSEEK_API_KEY')),
    `ожидали ошибку про DEEPSEEK_API_KEY, получили: ${JSON.stringify(result.errors)}`,
  );
});

test('validateConfig: apiKey только пробелы → ошибка про DEEPSEEK_API_KEY', () => {
  const result = validateConfig({ apiKey: '   ', resume: 'резюме', salary: 'зарплата' });
  assert.ok(result.errors.some((e) => e.includes('DEEPSEEK_API_KEY')));
});

// --- пустое resume → ошибка про resume.md ---

test('validateConfig: пустой resume → ok:false, ошибка про resume.md', () => {
  const result = validateConfig({ apiKey: 'sk-key', resume: '', salary: 'зарплата' });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.includes('resume.md')),
    `ожидали ошибку про resume.md, получили: ${JSON.stringify(result.errors)}`,
  );
});

test('validateConfig: resume только пробелы → ошибка про resume.md', () => {
  const result = validateConfig({ apiKey: 'sk-key', resume: '   ', salary: 'зарплата' });
  assert.ok(result.errors.some((e) => e.includes('resume.md')));
});

// --- пустой salary → ok:true (не блокирует), предупреждение ---

test('validateConfig: пустой salary → ok:true, warnings про salary.md', () => {
  const result = validateConfig({ apiKey: 'sk-key', resume: 'резюме', salary: '' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.ok(
    result.warnings.some((w) => w.includes('salary.md')),
    `ожидали предупреждение про salary.md, получили: ${JSON.stringify(result.warnings)}`,
  );
});

// --- всё пусто → ok:false, ошибки и про ключ, и про резюме; предупреждение про salary ---

test('validateConfig: всё пусто → ok:false, ошибки про ключ и резюме, предупреждение про salary', () => {
  const result = validateConfig({ apiKey: '', resume: '', salary: '' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('DEEPSEEK_API_KEY')));
  assert.ok(result.errors.some((e) => e.includes('resume.md')));
  assert.ok(result.warnings.some((w) => w.includes('salary.md')));
});

// --- не-строки трактуются как пустые, не бросает ---

test('validateConfig: null/undefined/число как значения → не бросает, трактует как пустые', () => {
  assert.doesNotThrow(() => {
    const r = validateConfig({ apiKey: null, resume: undefined, salary: 42 });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('DEEPSEEK_API_KEY')));
    assert.ok(r.errors.some((e) => e.includes('resume.md')));
    // salary=42 (не строка) → предупреждение
    assert.ok(r.warnings.some((w) => w.includes('salary.md')));
  });
});

// --- вызов без аргумента → не бросает, ok:false ---

test('validateConfig() без аргумента → не бросает, ok:false (ключ и резюме пусты)', () => {
  let result;
  assert.doesNotThrow(() => { result = validateConfig(); });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('DEEPSEEK_API_KEY')));
  assert.ok(result.errors.some((e) => e.includes('resume.md')));
});
