import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanGeneratedAnswer, parseJsonObject, stripLeadingGreeting } from '../src/lib/text.js';

// --- stripLeadingGreeting ---
test('stripLeadingGreeting: снимает «Здравствуйте!» в начале', () => {
  assert.equal(stripLeadingGreeting('Здравствуйте! Спасибо за интерес.'), 'Спасибо за интерес.');
});

test('stripLeadingGreeting: разные приветствия', () => {
  assert.equal(stripLeadingGreeting('Привет, готов обсудить.'), 'готов обсудить.');
  assert.equal(stripLeadingGreeting('Добрый день. Я DevOps.'), 'Я DevOps.');
  assert.equal(stripLeadingGreeting('Доброго времени суток — пишу по вакансии.'), 'пишу по вакансии.');
  assert.equal(stripLeadingGreeting('Приветствую! Можем обсудить детали.'), 'Можем обсудить детали.');
});

test('stripLeadingGreeting: текст без приветствия не меняется', () => {
  assert.equal(stripLeadingGreeting('Спасибо, готов выйти с понедельника.'), 'Спасибо, готов выйти с понедельника.');
});

test('stripLeadingGreeting: НЕ обрезает слово, начинающееся с приветствия (граница слова)', () => {
  // регрессия: «привет» не должен съедать начало этих слов
  assert.equal(stripLeadingGreeting('Приветствуется опыт работы с Docker.'), 'Приветствуется опыт работы с Docker.');
  assert.equal(stripLeadingGreeting('Приветливый тон важен.'), 'Приветливый тон важен.');
  assert.equal(stripLeadingGreeting('Здравствуйка готов.'), 'Здравствуйка готов.');
  assert.equal(stripLeadingGreeting('Добрые отношения в команде.'), 'Добрые отношения в команде.');
});

test('stripLeadingGreeting: приветствие без пунктуации (конец строки) → пусто', () => {
  assert.equal(stripLeadingGreeting('Здравствуйте'), '');
  assert.equal(stripLeadingGreeting('Привет'), '');
});

test('stripLeadingGreeting: приветствие НЕ в начале не трогаем', () => {
  assert.equal(stripLeadingGreeting('Готов начать. Здравствуйте не здесь.'), 'Готов начать. Здравствуйте не здесь.');
});

test('stripLeadingGreeting: снимает только одно ведущее приветствие', () => {
  // второе слово-приветствие остаётся (страховка от over-stripping)
  assert.equal(stripLeadingGreeting('Здравствуйте, привет ещё раз.'), 'привет ещё раз.');
});

test('stripLeadingGreeting: не-строка → пустая строка, не бросает', () => {
  assert.equal(stripLeadingGreeting(null), '');
  assert.equal(stripLeadingGreeting(undefined), '');
  assert.equal(stripLeadingGreeting(42), '');
});

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
