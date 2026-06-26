import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanGeneratedAnswer, parseJsonObject } from '../src/lib/text.js';

// --- parseJsonObject ---

test('parseJsonObject: fenced ```json``` блок', () => {
  const input = '```json\n{"a":1}\n```';
  assert.deepEqual(parseJsonObject(input), { a: 1 });
});

test('parseJsonObject: JSON с предшествующим текстом', () => {
  const input = 'bla {"a":1}';
  assert.deepEqual(parseJsonObject(input), { a: 1 });
});

test('parseJsonObject: голый JSON', () => {
  const input = '{"a":1}';
  assert.deepEqual(parseJsonObject(input), { a: 1 });
});

test('parseJsonObject: невалидный ввод бросает исключение', () => {
  assert.throws(() => parseJsonObject('not json'));
});

test('parseJsonObject: fenced-блок с хвостовой прозой после ```', () => {
  const input = '```json\n{"score":75}\n```\nвот и всё';
  assert.deepEqual(parseJsonObject(input), { score: 75 });
});

test('parseJsonObject: битый JSON внутри fence бросает (caller ловит)', () => {
  assert.throws(() => parseJsonObject('```json\n{"a":}\n```'));
});

// --- cleanGeneratedAnswer ---

test('cleanGeneratedAnswer: убирает обрамляющие кавычки', () => {
  assert.equal(cleanGeneratedAnswer('"привет"'), 'привет');
  assert.equal(cleanGeneratedAnswer('`текст`'), 'текст');
  assert.equal(cleanGeneratedAnswer("'слово'"), 'слово');
});

test('cleanGeneratedAnswer: NO_ANSWER → пустая строка', () => {
  assert.equal(cleanGeneratedAnswer('NO_ANSWER'), '');
  assert.equal(cleanGeneratedAnswer('no_answer'), '');
});

test('cleanGeneratedAnswer: убирает префикс "Ответ: "', () => {
  assert.equal(cleanGeneratedAnswer('Ответ: что-то'), 'что-то');
});

test('cleanGeneratedAnswer: убирает "[Имя]" плейсхолдер', () => {
  assert.equal(cleanGeneratedAnswer('[Имя], добрый день'), 'добрый день');
  assert.equal(cleanGeneratedAnswer('[Имя] текст'), 'текст');
});

test('cleanGeneratedAnswer: убирает "Меня зовут " фрагмент', () => {
  assert.equal(cleanGeneratedAnswer('Меня зовут Иван'), 'Иван');
  assert.equal(cleanGeneratedAnswer('Меня зовут, текст'), 'текст');
});

test('cleanGeneratedAnswer: обрезает пробелы', () => {
  assert.equal(cleanGeneratedAnswer('  привет  '), 'привет');
});
