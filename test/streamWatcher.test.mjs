import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMtimeSignature, signatureChanged } from '../src/lib/streamWatcher.js';

// --- buildMtimeSignature ---
test('buildMtimeSignature: стабильна независимо от порядка входа', () => {
  const a = buildMtimeSignature([
    { name: 'status/a.json', mtimeMs: 100 },
    { name: 'resources.jsonl', mtimeMs: 200 },
  ]);
  const b = buildMtimeSignature([
    { name: 'resources.jsonl', mtimeMs: 200 },
    { name: 'status/a.json', mtimeMs: 100 },
  ]);
  assert.equal(a, b);
});

test('buildMtimeSignature: пропускает записи без имени/валидного mtime', () => {
  const sig = buildMtimeSignature([
    { name: 'ok.json', mtimeMs: 10 },
    { name: '', mtimeMs: 20 },
    { name: 'bad.json', mtimeMs: NaN },
    { name: 'neg.json', mtimeMs: -1 },
    { mtimeMs: 30 },
    null,
    'мусор',
    { name: 'str.json', mtimeMs: '40' },
  ]);
  assert.equal(sig, 'ok.json:10');
});

test('buildMtimeSignature: не-массив → пустая строка', () => {
  assert.equal(buildMtimeSignature(null), '');
  assert.equal(buildMtimeSignature(undefined), '');
  assert.equal(buildMtimeSignature('x'), '');
  assert.equal(buildMtimeSignature({}), '');
});

test('buildMtimeSignature: пустой список → пустая строка', () => {
  assert.equal(buildMtimeSignature([]), '');
});

// --- signatureChanged (ядро детекта «mock-файл изменился → событие») ---
test('signatureChanged: изменение mtime файла → true', () => {
  const before = buildMtimeSignature([{ name: 's.json', mtimeMs: 100 }]);
  const after = buildMtimeSignature([{ name: 's.json', mtimeMs: 101 }]);
  assert.equal(signatureChanged(before, after), true);
});

test('signatureChanged: одинаковые сигнатуры → false', () => {
  const sig = buildMtimeSignature([{ name: 's.json', mtimeMs: 100 }]);
  assert.equal(signatureChanged(sig, sig), false);
});

test('signatureChanged: появление нового файла → true', () => {
  const before = buildMtimeSignature([{ name: 'a.json', mtimeMs: 1 }]);
  const after = buildMtimeSignature([
    { name: 'a.json', mtimeMs: 1 },
    { name: 'b.json', mtimeMs: 2 },
  ]);
  assert.equal(signatureChanged(before, after), true);
});

test('signatureChanged: исчезновение файла → true', () => {
  const before = buildMtimeSignature([
    { name: 'a.json', mtimeMs: 1 },
    { name: 'b.json', mtimeMs: 2 },
  ]);
  const after = buildMtimeSignature([{ name: 'a.json', mtimeMs: 1 }]);
  assert.equal(signatureChanged(before, after), true);
});

test('signatureChanged: prev null/undefined → true (первый снимок)', () => {
  assert.equal(signatureChanged(null, 'x'), true);
  assert.equal(signatureChanged(undefined, ''), true);
});
