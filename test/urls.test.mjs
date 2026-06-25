import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHhUrl, normalizeVacancyUrl } from '../src/lib/urls.js';

// --- normalizeHhUrl ---

test('normalizeHhUrl: убирает #hash-фрагмент', () => {
  assert.equal(normalizeHhUrl('https://hh.ru/vacancy/123#section'), 'https://hh.ru/vacancy/123');
});

test('normalizeHhUrl: сохраняет query-строку', () => {
  assert.equal(normalizeHhUrl('https://hh.ru/vacancy/123?foo=bar'), 'https://hh.ru/vacancy/123?foo=bar');
});

test('normalizeHhUrl: резолвит относительный путь против https://hh.ru', () => {
  assert.equal(normalizeHhUrl('/vacancy/123?x=1#frag'), 'https://hh.ru/vacancy/123?x=1');
});

// --- normalizeVacancyUrl ---

test('normalizeVacancyUrl: полный URL с query+hash → канонический /vacancy/<id>', () => {
  assert.equal(
    normalizeVacancyUrl('https://hh.ru/vacancy/98765432?query=test#details'),
    'https://hh.ru/vacancy/98765432',
  );
});

test('normalizeVacancyUrl: не-vacancy URL → пустая строка', () => {
  assert.equal(normalizeVacancyUrl('https://hh.ru/search/vacancy?text=x'), '');
});

test('normalizeVacancyUrl: путь с хвостовыми сегментами всё равно извлекает /vacancy/<digits>', () => {
  assert.equal(
    normalizeVacancyUrl('https://hh.ru/vacancy/42/apply?step=1'),
    'https://hh.ru/vacancy/42',
  );
});
