import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STALE_THRESHOLD_MS,
  buildHeartbeat,
  isStale,
} from '../src/lib/heartbeat.js';

// Фиксированные моменты — детерминированы, Date.now() не используется.
const NOW = new Date('2026-06-30T12:00:00.000Z');

// --- DEFAULT-константа ---

test('DEFAULT_STALE_THRESHOLD_MS: равна 120000', () => {
  assert.equal(DEFAULT_STALE_THRESHOLD_MS, 120000);
});

// --- buildHeartbeat: формирование записи ---

test('buildHeartbeat: полная запись из валидных полей', () => {
  const hb = buildHeartbeat({
    task: 'apply',
    account: 'acc1',
    phase: 'scoring',
    index: 12,
    total: 200,
    lastEvent: 'scored',
    state: 'ok',
    ts: NOW,
  });
  assert.deepEqual(hb, {
    task: 'apply',
    account: 'acc1',
    phase: 'scoring',
    index: 12,
    total: 200,
    lastEvent: 'scored',
    state: 'ok',
    ts: '2026-06-30T12:00:00.000Z',
  });
});

test('buildHeartbeat: ts из epoch ms и ISO-строки нормализуются в ISO', () => {
  const ms = buildHeartbeat({ ts: NOW.getTime() });
  assert.equal(ms.ts, '2026-06-30T12:00:00.000Z');
  const iso = buildHeartbeat({ ts: '2026-06-30T12:00:00.000Z' });
  assert.equal(iso.ts, '2026-06-30T12:00:00.000Z');
});

test('buildHeartbeat: state по умолчанию ok при отсутствии/мусоре', () => {
  assert.equal(buildHeartbeat({}).state, 'ok');
  assert.equal(buildHeartbeat({ state: '' }).state, 'ok');
  assert.equal(buildHeartbeat({ state: '   ' }).state, 'ok');
  assert.equal(buildHeartbeat({ state: 42 }).state, 'ok');
  assert.equal(buildHeartbeat({ state: 'captcha' }).state, 'captcha');
});

test('buildHeartbeat: index/total — конечное >=0 → floor, иначе null', () => {
  assert.equal(buildHeartbeat({ index: 5.9 }).index, 5);
  assert.equal(buildHeartbeat({ total: 0 }).total, 0);
  assert.equal(buildHeartbeat({ index: -1 }).index, null);
  assert.equal(buildHeartbeat({ index: NaN }).index, null);
  assert.equal(buildHeartbeat({ total: Infinity }).total, null);
  assert.equal(buildHeartbeat({ index: '3' }).index, null);
  assert.equal(buildHeartbeat({}).index, null);
});

test('buildHeartbeat: текстовые поля только строки, объекты не протекают', () => {
  assert.equal(buildHeartbeat({ task: 42 }).task, '');
  assert.equal(buildHeartbeat({ lastEvent: { secret: 'x' } }).lastEvent, '');
  assert.equal(buildHeartbeat({ account: 'acc2' }).account, 'acc2');
});

test('buildHeartbeat: невалидный/отсутствующий ts → null', () => {
  assert.equal(buildHeartbeat({ ts: 'не дата' }).ts, null);
  assert.equal(buildHeartbeat({ ts: new Date('invalid') }).ts, null);
  assert.equal(buildHeartbeat({ ts: NaN }).ts, null);
  assert.equal(buildHeartbeat({}).ts, null);
});

// --- buildHeartbeat: guard на не-объект/null ---

test('buildHeartbeat: не-объект/null → запись со всеми дефолтами, не бросает', () => {
  const expected = {
    task: '',
    account: '',
    phase: '',
    index: null,
    total: null,
    lastEvent: '',
    state: 'ok',
    ts: null,
  };
  assert.deepEqual(buildHeartbeat(null), expected);
  assert.deepEqual(buildHeartbeat(undefined), expected);
  assert.deepEqual(buildHeartbeat('строка'), expected);
  assert.deepEqual(buildHeartbeat(123), expected);
});

// --- isStale: свежий / устаревший ---

test('isStale: свежий хартбит (возраст < порога) → false', () => {
  const hb = buildHeartbeat({ ts: new Date(NOW.getTime() - 60000) });
  assert.equal(isStale(hb, NOW, 120000), false);
});

test('isStale: устаревший хартбит (возраст > порога) → true', () => {
  const hb = buildHeartbeat({ ts: new Date(NOW.getTime() - 180000) });
  assert.equal(isStale(hb, NOW, 120000), true);
});

test('isStale: граница включительно-свежая (возраст === порога) → false', () => {
  const hb = buildHeartbeat({ ts: new Date(NOW.getTime() - 120000) });
  assert.equal(isStale(hb, NOW, 120000), false);
});

test('isStale: ts в будущем → не устарел (false)', () => {
  const hb = buildHeartbeat({ ts: new Date(NOW.getTime() + 60000) });
  assert.equal(isStale(hb, NOW, 120000), false);
});

test('isStale: now как epoch ms тоже принимается', () => {
  const hb = buildHeartbeat({ ts: new Date(NOW.getTime() - 180000) });
  assert.equal(isStale(hb, NOW.getTime(), 120000), true);
});

test('isStale: невалидный/<=0 thresholdMs → DEFAULT_STALE_THRESHOLD_MS', () => {
  const fresh = buildHeartbeat({ ts: new Date(NOW.getTime() - 60000) });
  const stale = buildHeartbeat({ ts: new Date(NOW.getTime() - 200000) });
  assert.equal(isStale(fresh, NOW), false);
  assert.equal(isStale(fresh, NOW, 0), false);
  assert.equal(isStale(fresh, NOW, -5), false);
  assert.equal(isStale(fresh, NOW, NaN), false);
  assert.equal(isStale(stale, NOW), true);
});

// --- isStale: guard на не-объект/null + невалидный now ---

test('isStale: не-объект/null heartbeat → true (нет живого сигнала)', () => {
  assert.equal(isStale(null, NOW, 120000), true);
  assert.equal(isStale(undefined, NOW, 120000), true);
  assert.equal(isStale('строка', NOW, 120000), true);
  assert.equal(isStale(123, NOW, 120000), true);
});

test('isStale: хартбит без разбираемого ts → true', () => {
  assert.equal(isStale({ task: 'apply' }, NOW, 120000), true);
  assert.equal(isStale(buildHeartbeat({ task: 'apply' }), NOW, 120000), true);
});

test('isStale: невалидный now → TypeError', () => {
  const hb = buildHeartbeat({ ts: NOW });
  assert.throws(() => isStale(hb, new Date('invalid'), 120000), TypeError);
  assert.throws(() => isStale(hb, 'не дата', 120000), TypeError);
  assert.throws(() => isStale(hb, null, 120000), TypeError);
});
