import { test } from 'node:test';
import assert from 'node:assert/strict';
import { microEditDescription } from '../src/lib/resumeEdit.js';

// Все тесты детерминированы: чистая функция, без IO/сети.

// ─── toggle финальной точки ─────────────────────────────────────────────────

test('microEditDescription: текст с финальной точкой → убирает точку', () => {
  const r = microEditDescription('Настроил CI/CD и бэкапы.');
  assert.equal(r.next, 'Настроил CI/CD и бэкапы');
  assert.equal(r.change, 'removed_dot');
});

test('microEditDescription: текст без финальной точки → добавляет точку', () => {
  const r = microEditDescription('Настроил CI/CD и бэкапы');
  assert.equal(r.next, 'Настроил CI/CD и бэкапы.');
  assert.equal(r.change, 'added_dot');
});

test('microEditDescription: обратимость — два toggle возвращают исходный (после нормализации хвоста)', () => {
  const original = 'Опыт DevOps.';
  const once = microEditDescription(original).next;        // 'Опыт DevOps'
  const twice = microEditDescription(once).next;           // 'Опыт DevOps.'
  assert.equal(twice, original);
});

test('microEditDescription: хвостовые пробелы/переводы строк нормализуются', () => {
  const r = microEditDescription('Текст с пробелами   \n\n');
  assert.equal(r.next, 'Текст с пробелами.');
  assert.equal(r.change, 'added_dot');
});

test('microEditDescription: точка с хвостовыми пробелами → точка убирается', () => {
  const r = microEditDescription('Текст.  \n');
  assert.equal(r.next, 'Текст');
  assert.equal(r.change, 'removed_dot');
});

test('microEditDescription: правка ВСЕГДА меняет нормализованное значение', () => {
  for (const s of ['abc', 'abc.', 'a.b.c', '...', 'Опыт работы 5 лет', '']) {
    const r = microEditDescription(s);
    assert.notEqual(r.next, s.replace(/\s+$/, ''), `должно отличаться для: ${JSON.stringify(s)}`);
  }
});

// ─── guard-кейсы ─────────────────────────────────────────────────────────────

test('microEditDescription: пустая строка → добавляет точку', () => {
  const r = microEditDescription('');
  assert.equal(r.next, '.');
  assert.equal(r.change, 'added_dot');
});

test('microEditDescription: не-строка (число) → не падает, трактует как ""', () => {
  const r = microEditDescription(42);
  assert.equal(r.next, '.');
  assert.equal(r.change, 'added_dot');
});

test('microEditDescription: не-строка (null/undefined) → не падает', () => {
  assert.equal(microEditDescription(null).next, '.');
  assert.equal(microEditDescription(undefined).next, '.');
});
