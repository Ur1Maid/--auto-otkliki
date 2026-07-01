import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMatchPercent,
  isConfidentMatchReject,
  DEFAULT_MATCH_REJECT_THRESHOLD,
} from '../src/lib/matchBadge.js';

// В браузере текст плашки приходит с неразрывными пробелами ( ) между словами.
const NBSP = ' ';

test('parseMatchPercent: обычные пробелы', () => {
  assert.equal(parseMatchPercent('Подходит по навыкам на 80%'), 80);
});

test('parseMatchPercent: неразрывные пробелы (как в живом DOM)', () => {
  assert.equal(parseMatchPercent(`Подходит по${NBSP}навыкам на${NBSP}80%`), 80);
  assert.equal(parseMatchPercent(`Подходит${NBSP}по${NBSP}навыкам${NBSP}на${NBSP}100%`), 100);
});

test('parseMatchPercent: плашка внутри длинного текста карточки', () => {
  const card = 'DevOps-инженер до 260000 ₽ Volna.tech Москва Подходит по навыкам на 71% Откликнуться';
  assert.equal(parseMatchPercent(card), 71);
});

test('parseMatchPercent: границы 0..100 (кламп)', () => {
  assert.equal(parseMatchPercent('Подходит по навыкам на 0%'), 0);
  assert.equal(parseMatchPercent('Подходит по навыкам на 250%'), 100);
});

test('parseMatchPercent: нет плашки / мусор / не строка → null', () => {
  assert.equal(parseMatchPercent('DevOps-инженер Москва'), null);
  assert.equal(parseMatchPercent(''), null);
  assert.equal(parseMatchPercent(null), null);
  assert.equal(parseMatchPercent(undefined), null);
  assert.equal(parseMatchPercent(42), null);
  assert.equal(parseMatchPercent({}), null);
});

test('isConfidentMatchReject: ниже порога → true, на/выше → false', () => {
  assert.equal(isConfidentMatchReject(10), true);
  assert.equal(isConfidentMatchReject(DEFAULT_MATCH_REJECT_THRESHOLD), false); // строго ниже
  assert.equal(isConfidentMatchReject(80), false);
});

test('isConfidentMatchReject: нет плашки (null/не число) → false (не режем без сигнала)', () => {
  assert.equal(isConfidentMatchReject(null), false);
  assert.equal(isConfidentMatchReject(undefined), false);
  assert.equal(isConfidentMatchReject(NaN), false);
  assert.equal(isConfidentMatchReject('20'), false);
});

test('isConfidentMatchReject: кастомный порог; битый порог → дефолт', () => {
  assert.equal(isConfidentMatchReject(40, 50), true);
  assert.equal(isConfidentMatchReject(40, 30), false);
  assert.equal(isConfidentMatchReject(10, NaN), true); // битый порог → DEFAULT (20) → 10<20
});
