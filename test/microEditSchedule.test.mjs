import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CADENCE_MINUTES,
  DEFAULT_COOLDOWN_MINUTES,
  effectiveIntervalMinutes,
  nextAllowedAt,
  canRunNow,
  minutesUntilAllowed,
} from '../src/lib/microEditSchedule.js';

// Фиксированные базовые моменты — детерминированы, Date.now() не используется.
const BASE = new Date('2026-06-26T12:00:00.000Z');
const LAST = new Date('2026-06-26T11:00:00.000Z'); // на 60 мин раньше BASE

// --- DEFAULT-константы ---

test('DEFAULT_CADENCE_MINUTES: равна 30', () => {
  assert.equal(DEFAULT_CADENCE_MINUTES, 30);
});

test('DEFAULT_COOLDOWN_MINUTES: равна 0', () => {
  assert.equal(DEFAULT_COOLDOWN_MINUTES, 0);
});

// --- effectiveIntervalMinutes ---

test('effectiveIntervalMinutes: cadence > cooldown → cadence', () => {
  assert.equal(effectiveIntervalMinutes(60, 30), 60);
});

test('effectiveIntervalMinutes: cooldown > cadence → cooldown', () => {
  assert.equal(effectiveIntervalMinutes(30, 60), 60);
});

test('effectiveIntervalMinutes: равные значения → то же значение', () => {
  assert.equal(effectiveIntervalMinutes(45, 45), 45);
});

test('effectiveIntervalMinutes: без аргументов → DEFAULT_CADENCE_MINUTES', () => {
  assert.equal(effectiveIntervalMinutes(), DEFAULT_CADENCE_MINUTES);
});

test('effectiveIntervalMinutes: оба дефолта явно → DEFAULT_CADENCE_MINUTES', () => {
  assert.equal(
    effectiveIntervalMinutes(DEFAULT_CADENCE_MINUTES, DEFAULT_COOLDOWN_MINUTES),
    DEFAULT_CADENCE_MINUTES,
  );
});

test('effectiveIntervalMinutes: cadence=0 → нормализуется к DEFAULT_CADENCE_MINUTES', () => {
  assert.equal(effectiveIntervalMinutes(0, 0), DEFAULT_CADENCE_MINUTES);
});

test('effectiveIntervalMinutes: cadence отрицательный → нормализуется к DEFAULT_CADENCE_MINUTES', () => {
  assert.equal(effectiveIntervalMinutes(-10, 0), DEFAULT_CADENCE_MINUTES);
});

test('effectiveIntervalMinutes: cadence=NaN → нормализуется к DEFAULT_CADENCE_MINUTES', () => {
  assert.equal(effectiveIntervalMinutes(NaN, 0), DEFAULT_CADENCE_MINUTES);
});

test('effectiveIntervalMinutes: cadence=Infinity → нормализуется к DEFAULT_CADENCE_MINUTES', () => {
  assert.equal(effectiveIntervalMinutes(Infinity, 0), DEFAULT_CADENCE_MINUTES);
});

test('effectiveIntervalMinutes: cooldown=0 допустим (нет доп.кулдауна)', () => {
  // cooldown=0 допустим → effectiveInterval = max(30, 0) = 30
  assert.equal(effectiveIntervalMinutes(30, 0), 30);
});

test('effectiveIntervalMinutes: cooldown отрицательный → нормализуется к 0', () => {
  // cooldown < 0 → 0; effectiveInterval = max(30, 0) = 30
  assert.equal(effectiveIntervalMinutes(30, -5), 30);
});

test('effectiveIntervalMinutes: cooldown=NaN → нормализуется к 0', () => {
  assert.equal(effectiveIntervalMinutes(30, NaN), 30);
});

test('effectiveIntervalMinutes: cooldown=Infinity → нормализуется к 0', () => {
  assert.equal(effectiveIntervalMinutes(30, Infinity), 30);
});

test('effectiveIntervalMinutes: оба мусорные → DEFAULT_CADENCE_MINUTES', () => {
  assert.equal(effectiveIntervalMinutes(NaN, -1), DEFAULT_CADENCE_MINUTES);
});

test('effectiveIntervalMinutes: cooldown строже cadence (30 vs 60) → 60', () => {
  assert.equal(effectiveIntervalMinutes(30, 60), 60);
});

// --- nextAllowedAt ---

test('nextAllowedAt: дефолтный интервал 30 мин от известного момента', () => {
  const last = new Date('2026-06-26T12:00:00.000Z');
  const expected = new Date('2026-06-26T12:30:00.000Z');
  assert.deepEqual(nextAllowedAt(last), expected);
});

test('nextAllowedAt: кастомный интервал cadence=60 мин', () => {
  const last = new Date('2026-06-26T12:00:00.000Z');
  const expected = new Date('2026-06-26T13:00:00.000Z');
  assert.deepEqual(nextAllowedAt(last, 60, 0), expected);
});

test('nextAllowedAt: cooldown строже cadence (cadence=30, cooldown=90 → +90 мин)', () => {
  const last = new Date('2026-06-26T12:00:00.000Z');
  const expected = new Date('2026-06-26T13:30:00.000Z');
  assert.deepEqual(nextAllowedAt(last, 30, 90), expected);
});

test('nextAllowedAt: throw TypeError на невалидном lastRunAt (строка)', () => {
  assert.throws(
    () => nextAllowedAt('2026-06-26'),
    TypeError,
  );
});

test('nextAllowedAt: throw TypeError на Invalid Date', () => {
  assert.throws(
    () => nextAllowedAt(new Date('invalid')),
    TypeError,
  );
});

test('nextAllowedAt: throw TypeError на null', () => {
  assert.throws(
    () => nextAllowedAt(null),
    TypeError,
  );
});

test('nextAllowedAt: throw TypeError на undefined', () => {
  assert.throws(
    () => nextAllowedAt(undefined),
    TypeError,
  );
});

test('nextAllowedAt: throw TypeError на числе', () => {
  assert.throws(
    () => nextAllowedAt(Date.now()),
    TypeError,
  );
});

// --- canRunNow ---

test('canRunNow: lastRunAt=null → всегда true (никогда не запускались)', () => {
  assert.equal(canRunNow(BASE, null), true);
});

test('canRunNow: lastRunAt=undefined → всегда true', () => {
  assert.equal(canRunNow(BASE, undefined), true);
});

test('canRunNow: ровно на границе (now === nextAllowedAt) → true', () => {
  const last = new Date('2026-06-26T12:00:00.000Z');
  // effectiveInterval = 30 мин; nextAllowedAt = 12:30:00Z
  const now = new Date('2026-06-26T12:30:00.000Z');
  assert.equal(canRunNow(now, last, 30, 0), true);
});

test('canRunNow: на 1 мс раньше границы → false', () => {
  const last = new Date('2026-06-26T12:00:00.000Z');
  const now = new Date('2026-06-26T12:29:59.999Z');
  assert.equal(canRunNow(now, last, 30, 0), false);
});

test('canRunNow: сильно позже границы → true', () => {
  // LAST = 11:00Z, BASE = 12:00Z; interval=30 → nextAllowed=11:30Z; BASE > 11:30Z
  assert.equal(canRunNow(BASE, LAST, 30, 0), true);
});

test('canRunNow: в рамках интервала → false', () => {
  const last = new Date('2026-06-26T12:00:00.000Z');
  // now = 12:15Z; interval=30 → nextAllowed=12:30Z; 12:15 < 12:30 → false
  const now = new Date('2026-06-26T12:15:00.000Z');
  assert.equal(canRunNow(now, last, 30, 0), false);
});

test('canRunNow: cooldown строже cadence → false пока не прошёл cooldown', () => {
  const last = new Date('2026-06-26T12:00:00.000Z');
  // cadence=30, cooldown=60 → effectiveInterval=60; nextAllowed=13:00Z
  const now = new Date('2026-06-26T12:45:00.000Z'); // прошло 45 мин → ещё нельзя
  assert.equal(canRunNow(now, last, 30, 60), false);
});

test('canRunNow: cooldown строже cadence → true после cooldown', () => {
  const last = new Date('2026-06-26T12:00:00.000Z');
  const now = new Date('2026-06-26T13:00:00.000Z'); // ровно 60 мин → можно
  assert.equal(canRunNow(now, last, 30, 60), true);
});

test('canRunNow: throw TypeError на невалидном now (строка)', () => {
  assert.throws(
    () => canRunNow('2026-06-26T12:00:00Z', null),
    TypeError,
  );
});

test('canRunNow: throw TypeError на невалидном now (число)', () => {
  assert.throws(
    () => canRunNow(Date.now(), null),
    TypeError,
  );
});

test('canRunNow: throw TypeError на невалидном now (Invalid Date)', () => {
  assert.throws(
    () => canRunNow(new Date('not-a-date'), null),
    TypeError,
  );
});

test('canRunNow: throw TypeError на lastRunAt=строка (не null/undefined, не Date)', () => {
  assert.throws(
    () => canRunNow(BASE, '2026-06-26T11:00:00Z'),
    TypeError,
  );
});

test('canRunNow: throw TypeError на lastRunAt=число (не null/undefined, не Date)', () => {
  assert.throws(
    () => canRunNow(BASE, 12345),
    TypeError,
  );
});

test('canRunNow: throw TypeError на lastRunAt=Invalid Date', () => {
  assert.throws(
    () => canRunNow(BASE, new Date('bad')),
    TypeError,
  );
});

// --- minutesUntilAllowed ---

test('minutesUntilAllowed: lastRunAt=null → 0', () => {
  assert.equal(minutesUntilAllowed(BASE, null), 0);
});

test('minutesUntilAllowed: lastRunAt=undefined → 0', () => {
  assert.equal(minutesUntilAllowed(BASE, undefined), 0);
});

test('minutesUntilAllowed: уже прошёл интервал → 0', () => {
  // LAST=11:00Z, BASE=12:00Z, interval=30 → nextAllowed=11:30Z < BASE → 0
  assert.equal(minutesUntilAllowed(BASE, LAST, 30, 0), 0);
});

test('minutesUntilAllowed: ровно на границе (now === nextAllowedAt) → 0', () => {
  const last = new Date('2026-06-26T12:00:00.000Z');
  const now = new Date('2026-06-26T12:30:00.000Z');
  assert.equal(minutesUntilAllowed(now, last, 30, 0), 0);
});

test('minutesUntilAllowed: ровно половина интервала прошла → 15', () => {
  const last = new Date('2026-06-26T12:00:00.000Z');
  // прошло 15 мин, интервал 30 → осталось ровно 15 мин
  const now = new Date('2026-06-26T12:15:00.000Z');
  assert.equal(minutesUntilAllowed(now, last, 30, 0), 15);
});

test('minutesUntilAllowed: точное дробное значение (не округляется)', () => {
  const last = new Date('2026-06-26T12:00:00.000Z');
  // интервал 30, прошло 10 мин → осталось 20.0 мин
  const now = new Date('2026-06-26T12:10:00.000Z');
  assert.equal(minutesUntilAllowed(now, last, 30, 0), 20);
});

test('minutesUntilAllowed: дробные миллисекунды → float, не округляется', () => {
  const last = new Date('2026-06-26T12:00:00.000Z');
  // прошло 29 мин 59.5 с → осталось 0.5 с = 0.5/60 мин ≈ 0.008333…
  const now = new Date('2026-06-26T12:29:59.500Z');
  const result = minutesUntilAllowed(now, last, 30, 0);
  // 500 мс = 500/60000 мин
  assert.equal(result, 500 / 60000);
});

test('minutesUntilAllowed: cooldown строже cadence → ждём cooldown', () => {
  const last = new Date('2026-06-26T12:00:00.000Z');
  // cadence=30, cooldown=60 → effectiveInterval=60; прошло 30 мин → осталось 30
  const now = new Date('2026-06-26T12:30:00.000Z');
  assert.equal(minutesUntilAllowed(now, last, 30, 60), 30);
});

test('minutesUntilAllowed: throw TypeError на невалидном now', () => {
  assert.throws(
    () => minutesUntilAllowed('bad', null),
    TypeError,
  );
});

test('minutesUntilAllowed: throw TypeError на lastRunAt=строка', () => {
  assert.throws(
    () => minutesUntilAllowed(BASE, 'yesterday'),
    TypeError,
  );
});

test('minutesUntilAllowed: throw TypeError на lastRunAt=Invalid Date', () => {
  assert.throws(
    () => minutesUntilAllowed(BASE, new Date('nope')),
    TypeError,
  );
});
