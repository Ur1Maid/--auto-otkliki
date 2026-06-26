import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prioritizeRemoteFirst } from '../src/lib/vacancyPriority.js';

const V = (id) => `https://hh.ru/vacancy/${id}`;

test('prioritizeRemoteFirst: удалёнка идёт перед остальными', () => {
  const out = prioritizeRemoteFirst([
    { url: V(1), remote: false },
    { url: V(2), remote: true },
    { url: V(3), remote: false },
    { url: V(4), remote: true },
  ]);
  assert.deepEqual(out, [V(2), V(4), V(1), V(3)]);
});

test('prioritizeRemoteFirst: ничего не отсекает (все вакансии остаются)', () => {
  const out = prioritizeRemoteFirst([
    { url: V(1), remote: false },
    { url: V(2), remote: false },
    { url: V(3), remote: true },
  ]);
  assert.equal(out.length, 3);
  assert.deepEqual([...out].sort(), [V(1), V(2), V(3)].sort());
});

test('prioritizeRemoteFirst: стабильный порядок внутри каждой группы', () => {
  const out = prioritizeRemoteFirst([
    { url: V(10), remote: true },
    { url: V(20), remote: false },
    { url: V(30), remote: true },
    { url: V(40), remote: false },
  ]);
  assert.deepEqual(out, [V(10), V(30), V(20), V(40)]);
});

test('prioritizeRemoteFirst: дедуп по канону /vacancy/<id>, query/hash игнорируются', () => {
  const out = prioritizeRemoteFirst([
    { url: 'https://hh.ru/vacancy/777?query=devops', remote: false },
    { url: 'https://hh.ru/vacancy/777#section', remote: false },
  ]);
  assert.deepEqual(out, [V(777)]);
});

test('prioritizeRemoteFirst: один URL и remote, и не-remote → считается remote (OR)', () => {
  const out = prioritizeRemoteFirst([
    { url: V(5), remote: false },
    { url: V(9), remote: false },
    { url: V(5), remote: true }, // то же, но remote
  ]);
  // V(5) попал первым появлением (порядок) и помечен remote → впереди
  assert.deepEqual(out, [V(5), V(9)]);
});

test('prioritizeRemoteFirst: не-/vacancy/ и пустые URL молча пропускаются', () => {
  const out = prioritizeRemoteFirst([
    { url: '', remote: true },
    { url: 'https://adsrv.hh.ru/click?b=1', remote: true },
    { url: V(1), remote: false },
    { url: 'не-url', remote: true },
  ]);
  assert.deepEqual(out, [V(1)]);
});

test('prioritizeRemoteFirst: не-массив на входе → пустой результат', () => {
  assert.deepEqual(prioritizeRemoteFirst(null), []);
  assert.deepEqual(prioritizeRemoteFirst(undefined), []);
  assert.deepEqual(prioritizeRemoteFirst('foo'), []);
});
