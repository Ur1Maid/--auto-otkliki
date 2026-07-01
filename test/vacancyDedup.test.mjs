import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeReposts } from '../src/lib/vacancyDedup.js';

const V = (id) => `https://hh.ru/vacancy/${id}`;

test('dedupeReposts: репост (одинаковый title+company, разные url) схлопывается, первый остаётся', () => {
  const out = dedupeReposts([
    { url: V(1), title: 'DevOps-инженер', company: 'Volna.tech' },
    { url: V(2), title: 'DevOps-инженер', company: 'Volna.tech' },
    { url: V(3), title: 'SRE', company: 'Volna.tech' },
  ]);
  assert.deepEqual(out.map((c) => c.url), [V(1), V(3)]);
});

test('dedupeReposts: одинаковый title у РАЗНЫХ компаний НЕ сливается', () => {
  const out = dedupeReposts([
    { url: V(1), title: 'DevOps Engineer', company: 'Volna.tech' },
    { url: V(2), title: 'DevOps Engineer', company: 'Yandex' },
  ]);
  assert.equal(out.length, 2);
});

test('dedupeReposts: нормализация регистра/пробелов в ключе', () => {
  const out = dedupeReposts([
    { url: V(1), title: 'DevOps  Инженер', company: 'Volna.tech' },
    { url: V(2), title: 'devops инженер', company: ' volna.tech ' },
  ]);
  assert.deepEqual(out.map((c) => c.url), [V(1)]);
});

test('dedupeReposts: пустая/отсутствующая company → НЕ схлопываем (консервативно)', () => {
  const out = dedupeReposts([
    { url: V(1), title: 'DevOps', company: '' },
    { url: V(2), title: 'DevOps', company: '' },
    { url: V(3), title: 'DevOps' },
    { url: V(4), title: 'DevOps', company: '   ' },
  ]);
  assert.equal(out.length, 4);
});

test('dedupeReposts: пустой title → НЕ схлопываем', () => {
  const out = dedupeReposts([
    { url: V(1), title: '', company: 'Volna.tech' },
    { url: V(2), title: '', company: 'Volna.tech' },
  ]);
  assert.equal(out.length, 2);
});

test('dedupeReposts: сохраняет прочие поля карточки (remote/matchPercent)', () => {
  const out = dedupeReposts([
    { url: V(1), title: 'DevOps', company: 'Volna.tech', remote: true, matchPercent: 80 },
  ]);
  assert.deepEqual(out, [{ url: V(1), title: 'DevOps', company: 'Volna.tech', remote: true, matchPercent: 80 }]);
});

test('dedupeReposts: guard — не массив / битые элементы', () => {
  assert.deepEqual(dedupeReposts(null), []);
  assert.deepEqual(dedupeReposts(undefined), []);
  assert.deepEqual(dedupeReposts('nope'), []);
  const out = dedupeReposts([null, 42, { url: V(1), title: 'A', company: 'B' }, undefined]);
  assert.deepEqual(out.map((c) => c.url), [V(1)]);
});
