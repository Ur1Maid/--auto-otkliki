import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonical,
  applyMicroEdit,
  revert,
  MICRO_EDIT_MARKER,
} from '../src/lib/microEdit.js';

// --- MICRO_EDIT_MARKER ---

test('MICRO_EDIT_MARKER: является строкой длиной 1', () => {
  assert.equal(typeof MICRO_EDIT_MARKER, 'string');
  assert.equal(MICRO_EDIT_MARKER.length, 1);
});

// --- canonical ---

test('canonical: убирает одиночный хвостовой перевод строки', () => {
  assert.equal(canonical('hello\n'), 'hello');
});

test('canonical: убирает несколько хвостовых переводов строк', () => {
  assert.equal(canonical('hello\n\n\n'), 'hello');
});

test('canonical: убирает хвостовые пробелы', () => {
  assert.equal(canonical('hello   '), 'hello');
});

test('canonical: убирает смешанные хвостовые пробелы и \n', () => {
  assert.equal(canonical('hello \n \n'), 'hello');
});

test('canonical: внутренние переводы строк сохраняются', () => {
  const md = '# Заголовок\n\nПараграф 1\nПараграф 2';
  assert.equal(canonical(md), md);
});

test('canonical: текст без хвостовых пробелов не меняется', () => {
  assert.equal(canonical('hello'), 'hello');
});

test('canonical: пустая строка → пустая строка', () => {
  assert.equal(canonical(''), '');
});

test('canonical: строка только из пробелов → пустая строка', () => {
  assert.equal(canonical('   \n\n  '), '');
});

test('canonical: идемпотентен — canonical(canonical(t)) === canonical(t)', () => {
  const cases = [
    'hello\n',
    '  text  \n',
    'многострочный\nтекст\n\n',
    '',
    '  ',
  ];
  for (const t of cases) {
    assert.equal(canonical(canonical(t)), canonical(t), `нарушение идемпотентности для: ${JSON.stringify(t)}`);
  }
});

test('canonical: не-строка null → пустая строка', () => {
  assert.equal(canonical(null), '');
});

test('canonical: не-строка undefined → пустая строка', () => {
  assert.equal(canonical(undefined), '');
});

test('canonical: число → пустая строка', () => {
  assert.equal(canonical(42), '');
});

test('canonical: объект → пустая строка', () => {
  assert.equal(canonical({}), '');
});

// --- applyMicroEdit ---

test('applyMicroEdit: добавляет MARKER к тексту без хвостового \n', () => {
  assert.equal(applyMicroEdit('hello'), 'hello' + MICRO_EDIT_MARKER);
});

test('applyMicroEdit: текст уже с \n — canonical сначала убирает его, затем маркер добавляется', () => {
  // canonical('hello\n') = 'hello'; applyMicroEdit → 'hello\n'
  assert.equal(applyMicroEdit('hello\n'), 'hello' + MICRO_EDIT_MARKER);
});

test('applyMicroEdit: текст с несколькими хвостовыми \n — результат canonical + один маркер', () => {
  assert.equal(applyMicroEdit('hello\n\n\n'), 'hello' + MICRO_EDIT_MARKER);
});

test('applyMicroEdit: пустая строка → только MARKER', () => {
  // canonical('') === ''; applyMicroEdit('') === MARKER
  // Инвариант «applyMicroEdit(t) !== canonical(t)» выполняется: MARKER !== ''
  assert.equal(applyMicroEdit(''), MICRO_EDIT_MARKER);
  assert.notEqual(applyMicroEdit(''), canonical(''));
});

test('applyMicroEdit: не-строка → MARKER (canonical → пустая строка)', () => {
  assert.equal(applyMicroEdit(null), MICRO_EDIT_MARKER);
});

test('applyMicroEdit: многострочный markdown-фрагмент резюме', () => {
  const resume = '# Опыт\n\n- Разработчик (2020–2025)\n- Навыки: Node.js, Playwright';
  const result = applyMicroEdit(resume);
  // Должен совпадать с canonical + маркер
  assert.equal(result, canonical(resume) + MICRO_EDIT_MARKER);
  // Внутренняя структура сохранена
  assert.ok(result.includes('Node.js, Playwright'));
});

// --- revert ---

test('revert: возвращает canonical(t)', () => {
  const cases = [
    'hello\n',
    'hello',
    'многострочный\nтекст\n',
    '',
    '   \n',
  ];
  for (const t of cases) {
    assert.equal(revert(t), canonical(t), `revert !== canonical для: ${JSON.stringify(t)}`);
  }
});

test('revert: не-строка null → пустая строка', () => {
  assert.equal(revert(null), '');
});

// --- ИНВАРИАНТЫ ---

// Вспомогательные образцы для проверки инвариантов.
const SAMPLES = [
  'hello',
  'hello\n',
  'hello\n\n',
  'hello   ',
  '',
  '  \n  ',
  '# Резюме\n\n## Опыт\n- Пункт 1\n- Пункт 2\n',
  'Одна строка без переноса',
  'Строка с пробелом в конце ',
];

test('инвариант: revert(applyMicroEdit(t)) === canonical(t) для всех образцов', () => {
  for (const t of SAMPLES) {
    assert.equal(
      revert(applyMicroEdit(t)),
      canonical(t),
      `нарушение для: ${JSON.stringify(t)}`,
    );
  }
});

test('инвариант: canonical(applyMicroEdit(t)) === canonical(t) — смысл сохранён', () => {
  for (const t of SAMPLES) {
    assert.equal(
      canonical(applyMicroEdit(t)),
      canonical(t),
      `нарушение сохранения смысла для: ${JSON.stringify(t)}`,
    );
  }
});

test('инвариант: applyMicroEdit(t) !== canonical(t) для непустых образцов', () => {
  // Для непустого canonical(t) правка реально меняет строку.
  const nonEmpty = SAMPLES.filter((t) => canonical(t) !== '');
  assert.ok(nonEmpty.length > 0, 'нужен хотя бы один непустой образец');
  for (const t of nonEmpty) {
    assert.notEqual(
      applyMicroEdit(t),
      canonical(t),
      `правка не изменила строку для: ${JSON.stringify(t)}`,
    );
  }
});

test('инвариант: дифф минимален — applyMicroEdit(t).length - canonical(t).length === MARKER.length', () => {
  for (const t of SAMPLES) {
    const diff = applyMicroEdit(t).length - canonical(t).length;
    assert.equal(
      diff,
      MICRO_EDIT_MARKER.length,
      `неожиданный дифф ${diff} для: ${JSON.stringify(t)}`,
    );
  }
});

test('инвариант: applyMicroEdit(t) начинается с canonical(t)', () => {
  for (const t of SAMPLES) {
    const c = canonical(t);
    const edited = applyMicroEdit(t);
    assert.ok(
      edited.startsWith(c),
      `applyMicroEdit не начинается с canonical для: ${JSON.stringify(t)}`,
    );
  }
});

// --- edge-кейсы ---

test('edge: строка только из пробелов и \n — canonical пустая, applyMicroEdit = MARKER', () => {
  const t = '   \n\n  ';
  assert.equal(canonical(t), '');
  assert.equal(applyMicroEdit(t), MICRO_EDIT_MARKER);
  assert.equal(revert(t), '');
});

test('edge: текст с MARKER внутри — canonical оставляет внутренний \n нетронутым', () => {
  const t = 'строка\nследующая';
  // trimEnd не трогает внутренние символы
  assert.equal(canonical(t), 'строка\nследующая');
  assert.equal(applyMicroEdit(t), 'строка\nследующая\n');
});

test('edge: длинный markdown-текст резюме (реалистичный)', () => {
  const resume = [
    '# Иванов Иван',
    '',
    '## Опыт работы',
    '**2020–2025** — Старший разработчик, ООО «Пример»',
    '- Node.js, PostgreSQL, Docker',
    '- Playwright, REST API',
    '',
    '## Образование',
    'МГУ, Факультет ВМК, 2020',
    '',
  ].join('\n');

  const c = canonical(resume);
  const edited = applyMicroEdit(resume);

  // Внутренняя структура сохранена
  assert.ok(c.includes('Node.js'));
  assert.ok(c.includes('МГУ'));

  // Инварианты
  assert.equal(revert(edited), c);
  assert.equal(canonical(edited), c);
  assert.equal(edited.length - c.length, MICRO_EDIT_MARKER.length);
  assert.notEqual(edited, c);
});
