import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prioritizeRemoteFirst, looksRemoteInText } from '../src/lib/vacancyPriority.js';

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

test('prioritizeRemoteFirst: внутри группы выше matchPercent идёт раньше', () => {
  const out = prioritizeRemoteFirst([
    { url: V(1), remote: true, matchPercent: 60 },
    { url: V(2), remote: true, matchPercent: 95 },
    { url: V(3), remote: false, matchPercent: 100 },
    { url: V(4), remote: true, matchPercent: 80 },
  ]);
  // remote по match desc: V2(95), V4(80), V1(60); затем не-remote: V3(100)
  assert.deepEqual(out, [V(2), V(4), V(1), V(3)]);
});

test('prioritizeRemoteFirst: карточки без плашки идут в конец своей группы', () => {
  const out = prioritizeRemoteFirst([
    { url: V(1), remote: false },                    // без match
    { url: V(2), remote: false, matchPercent: 70 },
    { url: V(3), remote: false, matchPercent: 40 },
  ]);
  assert.deepEqual(out, [V(2), V(3), V(1)]);
});

test('prioritizeRemoteFirst: remote приоритетнее matchPercent (группа важнее)', () => {
  const out = prioritizeRemoteFirst([
    { url: V(1), remote: false, matchPercent: 100 },
    { url: V(2), remote: true, matchPercent: 30 },
  ]);
  // удалёнка вперёд, даже при меньшем проценте
  assert.deepEqual(out, [V(2), V(1)]);
});

test('prioritizeRemoteFirst: match берётся максимальный по вхождениям одного URL', () => {
  const out = prioritizeRemoteFirst([
    { url: V(1), remote: false, matchPercent: 40 },
    { url: V(2), remote: false, matchPercent: 50 },
    { url: V(1), remote: false, matchPercent: 90 }, // тот же URL, выше match
  ]);
  // V(1) поднимается до 90 → раньше V(2, 50)
  assert.deepEqual(out, [V(1), V(2)]);
});

// --- looksRemoteInText ---

test('looksRemoteInText: ловит явные формулировки удалёнки', () => {
  assert.equal(looksRemoteInText('Удалённая работа, гибкий график'), true);
  assert.equal(looksRemoteInText('Работаем на удалёнке'), true);
  assert.equal(looksRemoteInText('Можно удалённо из любого города'), true);
  assert.equal(looksRemoteInText('Формат работы: полностью удалённый'), true);
  assert.equal(looksRemoteInText('Дистанционная работа'), true);
  assert.equal(looksRemoteInText('Fully remote position'), true);
  assert.equal(looksRemoteInText('Work from home available'), true);
});

test('looksRemoteInText: не ловит ложные срабатывания', () => {
  assert.equal(looksRemoteInText('Удалённость офиса от метро 5 минут'), false);
  assert.equal(looksRemoteInText('Офис в центре, полный день'), false);
  assert.equal(looksRemoteInText(''), false);
  assert.equal(looksRemoteInText(null), false);
  assert.equal(looksRemoteInText(undefined), false);
});
