import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePreferences,
  findPreferenceCategory,
  answerFromPreferences,
} from '../src/lib/preferenceAnswer.js';

// Текст предпочтений из примера (config/accounts/example/preferences.example.txt),
// без комментариев и шапки — используется как базовый фикстур.
const EXAMPLE_PREFS = `
# Комментарий — должен игнорироваться
Готовность к переезду: нет
Готовность к командировкам: редкие, по согласованию
Тип занятости: полная
Формат работы: удалённо или гибрид
Желаемый график: гибкий, 5/2
Локация: Москва
Гражданство: РФ
Разрешение на работу: РФ
Готовность к релокации за рубеж: нет
Можно ли связаться в нерабочее время: да, мессенджеры
`.trim();

// ─── parsePreferences ─────────────────────────────────────────────────────────

test('parsePreferences: корректно разбирает пример — 10 пар (без комментария)', () => {
  const result = parsePreferences(EXAMPLE_PREFS);
  assert.equal(result.length, 10);
});

test('parsePreferences: значения извлекаются корректно', () => {
  const result = parsePreferences(EXAMPLE_PREFS);
  const map = Object.fromEntries(result.map(({ key, value }) => [key, value]));
  assert.equal(map['Готовность к переезду'], 'нет');
  assert.equal(map['Готовность к командировкам'], 'редкие, по согласованию');
  assert.equal(map['Тип занятости'], 'полная');
  assert.equal(map['Формат работы'], 'удалённо или гибрид');
  assert.equal(map['Желаемый график'], 'гибкий, 5/2');
  assert.equal(map['Локация'], 'Москва');
  assert.equal(map['Гражданство'], 'РФ');
  assert.equal(map['Разрешение на работу'], 'РФ');
  assert.equal(map['Готовность к релокации за рубеж'], 'нет');
  assert.equal(map['Можно ли связаться в нерабочее время'], 'да, мессенджеры');
});

test('parsePreferences: пропускает строки-комментарии (#)', () => {
  const result = parsePreferences('# это комментарий\nКлюч: значение');
  assert.equal(result.length, 1);
  assert.equal(result[0].key, 'Ключ');
});

test('parsePreferences: пропускает пустые строки', () => {
  const result = parsePreferences('\n\nКлюч: значение\n\n');
  assert.equal(result.length, 1);
});

test('parsePreferences: пропускает строки без двоеточия', () => {
  const result = parsePreferences('строка без двоеточия\nКлюч: значение');
  assert.equal(result.length, 1);
  assert.equal(result[0].key, 'Ключ');
});

test('parsePreferences: пропускает строки с пустым значением', () => {
  const result = parsePreferences('Ключ:   \nДругой: значение');
  assert.equal(result.length, 1);
  assert.equal(result[0].key, 'Другой');
});

test('parsePreferences: пропускает строку где двоеточие первый символ (нет ключа)', () => {
  const result = parsePreferences(': значение\nКлюч: значение');
  assert.equal(result.length, 1);
  assert.equal(result[0].key, 'Ключ');
});

test('parsePreferences: null → []', () => {
  assert.deepEqual(parsePreferences(null), []);
});

test('parsePreferences: undefined → []', () => {
  assert.deepEqual(parsePreferences(undefined), []);
});

test('parsePreferences: 123 → []', () => {
  assert.deepEqual(parsePreferences(123), []);
});

test('parsePreferences: значение может содержать двоеточие (берётся только первое)', () => {
  const result = parsePreferences('Ключ: значение: с двоеточием');
  assert.equal(result.length, 1);
  assert.equal(result[0].value, 'значение: с двоеточием');
});

// ─── findPreferenceCategory ───────────────────────────────────────────────────

test('findPreferenceCategory: вопрос о переезде (без рубежа) → relocation', () => {
  assert.equal(findPreferenceCategory('Готовы к переезду в другой город?'), 'relocation');
});

test('findPreferenceCategory: вопрос о переезде за рубеж → relocationAbroad', () => {
  assert.equal(findPreferenceCategory('Рассматриваете переезд за рубеж?'), 'relocationAbroad');
});

test('findPreferenceCategory: relocationAbroad не матчится как relocation', () => {
  const cat = findPreferenceCategory('Готовы к переезду за рубеж?');
  assert.equal(cat, 'relocationAbroad');
});

test('findPreferenceCategory: вопрос о командировках → travel', () => {
  assert.equal(findPreferenceCategory('Готовы к командировкам?'), 'travel');
});

test('findPreferenceCategory: вопрос о типе занятости → employmentType', () => {
  assert.equal(findPreferenceCategory('Какой тип занятости предпочитаете?'), 'employmentType');
});

test('findPreferenceCategory: вопрос о формате работы → workFormat', () => {
  assert.equal(findPreferenceCategory('Какой формат работы вам подходит?'), 'workFormat');
});

test('findPreferenceCategory: удалённо → workFormat', () => {
  assert.equal(findPreferenceCategory('Готовы работать удалённо?'), 'workFormat');
});

test('findPreferenceCategory: гибрид → workFormat', () => {
  assert.equal(findPreferenceCategory('Рассматриваете гибрид?'), 'workFormat');
});

test('findPreferenceCategory: вопрос о графике → schedule', () => {
  assert.equal(findPreferenceCategory('Какой желаемый график работы?'), 'schedule');
});

test('findPreferenceCategory: вопрос о гражданстве → citizenship', () => {
  assert.equal(findPreferenceCategory('Ваше гражданство?'), 'citizenship');
});

test('findPreferenceCategory: вопрос о разрешении на работу → workPermit', () => {
  assert.equal(findPreferenceCategory('Есть ли у вас разрешение на работу?'), 'workPermit');
});

test('findPreferenceCategory: вопрос о нерабочем времени → offHoursContact', () => {
  assert.equal(findPreferenceCategory('Можно ли связаться в нерабочее время?'), 'offHoursContact');
});

test('findPreferenceCategory: нерелевантный вопрос → null', () => {
  assert.equal(findPreferenceCategory('Ваш опыт с Kubernetes?'), null);
});

test('findPreferenceCategory: null → null', () => {
  assert.equal(findPreferenceCategory(null), null);
});

test('findPreferenceCategory: undefined → null', () => {
  assert.equal(findPreferenceCategory(undefined), null);
});

test('findPreferenceCategory: пустая строка → null', () => {
  assert.equal(findPreferenceCategory(''), null);
});

test('findPreferenceCategory: строка из пробелов → null', () => {
  assert.equal(findPreferenceCategory('   '), null);
});

// ─── answerFromPreferences ────────────────────────────────────────────────────

test('answerFromPreferences: переезд → нет (из строкового preferences)', () => {
  const answer = answerFromPreferences('Готовы к переезду в другой город?', EXAMPLE_PREFS);
  assert.equal(answer, 'нет');
});

test('answerFromPreferences: переезд за рубеж → нет (из ключа "за рубеж")', () => {
  const answer = answerFromPreferences('Рассматриваете переезд за рубеж?', EXAMPLE_PREFS);
  assert.equal(answer, 'нет');
});

test('answerFromPreferences: командировки → редкие, по согласованию', () => {
  const answer = answerFromPreferences('Готовы к командировкам?', EXAMPLE_PREFS);
  assert.equal(answer, 'редкие, по согласованию');
});

test('answerFromPreferences: тип занятости → полная', () => {
  const answer = answerFromPreferences('Какой тип занятости предпочитаете?', EXAMPLE_PREFS);
  assert.equal(answer, 'полная');
});

test('answerFromPreferences: формат работы → удалённо или гибрид', () => {
  const answer = answerFromPreferences('Какой формат работы вам подходит?', EXAMPLE_PREFS);
  assert.equal(answer, 'удалённо или гибрид');
});

test('answerFromPreferences: гражданство → РФ', () => {
  const answer = answerFromPreferences('Ваше гражданство?', EXAMPLE_PREFS);
  assert.equal(answer, 'РФ');
});

test('answerFromPreferences: нерабочее время → да, мессенджеры', () => {
  const answer = answerFromPreferences('Можно ли связаться в нерабочее время?', EXAMPLE_PREFS);
  assert.equal(answer, 'да, мессенджеры');
});

test('answerFromPreferences: нерелевантный вопрос → null', () => {
  const answer = answerFromPreferences('Ваш опыт с Kubernetes?', EXAMPLE_PREFS);
  assert.equal(answer, null);
});

test('answerFromPreferences: вопрос в категории, ключ отсутствует в предпочтениях → null', () => {
  // Предпочтения без ключа переезда
  const prefs = 'Тип занятости: полная\nГражданство: РФ';
  const answer = answerFromPreferences('Готовы к переезду?', prefs);
  assert.equal(answer, null);
});

test('answerFromPreferences: пустая строка предпочтений → null', () => {
  const answer = answerFromPreferences('Готовы к переезду?', '');
  assert.equal(answer, null);
});

test('answerFromPreferences: принимает уже разобранный массив (parity)', () => {
  const parsed = parsePreferences(EXAMPLE_PREFS);
  const answer = answerFromPreferences('Какой тип занятости предпочитаете?', parsed);
  assert.equal(answer, 'полная');
});

test('answerFromPreferences: разобранный массив без нужного ключа → null', () => {
  const parsed = parsePreferences('Гражданство: РФ');
  const answer = answerFromPreferences('Готовы к переезду?', parsed);
  assert.equal(answer, null);
});

test('answerFromPreferences: переезд и переезд за рубеж возвращают разные значения', () => {
  const prefs = 'Готовность к переезду: возможно\nГотовность к релокации за рубеж: нет';
  const reloc = answerFromPreferences('Готовы к переезду в другой город?', prefs);
  const abroad = answerFromPreferences('Рассматриваете переезд за рубеж?', prefs);
  assert.equal(reloc, 'возможно');
  assert.equal(abroad, 'нет');
});

test('answerFromPreferences: массив с мусорными элементами → null, не бросает', () => {
  assert.doesNotThrow(() => {
    const answer = answerFromPreferences('Готовы к переезду?', [null, 123, { key: 'x' }]);
    assert.equal(answer, null);
  });
});

test('answerFromPreferences: ключ «Релокация» не утекает в ответ о локации', () => {
  const prefs = 'Релокация: возможно';
  const answer = answerFromPreferences('Ваш город проживания?', prefs);
  assert.equal(answer, null);
});

test('answerFromPreferences: локация извлекается из ключа «Локация»', () => {
  const answer = answerFromPreferences('Ваш город проживания?', EXAMPLE_PREFS);
  assert.equal(answer, 'Москва');
});
