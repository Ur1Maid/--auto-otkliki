import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mskParts,
  isWithinWorkingHours,
  nextRunAt,
  WORK_START_HOUR,
  WORK_END_HOUR,
} from '../src/lib/schedule.js';

// Все тесты используют фиксированные UTC-инстанты (не Date.now()), что гарантирует
// детерминированность независимо от TZ машины и момента запуска.
// Ссылочный офсет МСК: UTC+3 (без летнего времени с 2014).
// Примеры: 06:00 UTC = 09:00 МСК, 15:00 UTC = 18:00 МСК, 04:00 UTC = 07:00 МСК.

// --- Константы ---

test('WORK_START_HOUR === 9', () => {
  assert.equal(WORK_START_HOUR, 9);
});

test('WORK_END_HOUR === 18', () => {
  assert.equal(WORK_END_HOUR, 18);
});

// --- mskParts ---

test('mskParts: 2026-06-15T06:00:00Z → hour=9, day=15, month=6, year=2026', () => {
  // 06:00 UTC = 09:00 МСК
  const d = new Date('2026-06-15T06:00:00Z');
  const p = mskParts(d);
  assert.equal(p.hour, 9, 'hour должен быть 9 (МСК)');
  assert.equal(p.minute, 0);
  assert.equal(p.day, 15);
  assert.equal(p.month, 6);
  assert.equal(p.year, 2026);
});

test('mskParts: 2026-06-15T14:59:00Z → hour=17, minute=59 (МСК)', () => {
  // 14:59 UTC = 17:59 МСК
  const d = new Date('2026-06-15T14:59:00Z');
  const p = mskParts(d);
  assert.equal(p.hour, 17);
  assert.equal(p.minute, 59);
});

test('mskParts: полночь МСК → hour=0 следующего дня по МСК', () => {
  // 2026-06-15T21:00:00Z = 00:00 МСК 16.06.2026
  const d = new Date('2026-06-15T21:00:00Z');
  const p = mskParts(d);
  assert.equal(p.hour, 0);
  assert.equal(p.day, 16);
  assert.equal(p.month, 6);
});

test('mskParts: возвращает объект со всеми ключами (year, month, day, hour, minute, weekday)', () => {
  const d = new Date('2026-06-15T06:00:00Z');
  const p = mskParts(d);
  for (const key of ['year', 'month', 'day', 'hour', 'minute', 'weekday']) {
    assert.ok(key in p, `ключ "${key}" должен присутствовать`);
  }
});

test('mskParts: невалидный Date → выброс TypeError', () => {
  assert.throws(() => mskParts(new Date('invalid')), TypeError);
});

test('mskParts: не-Date → выброс TypeError', () => {
  assert.throws(() => mskParts('2026-06-15'), TypeError);
  assert.throws(() => mskParts(null), TypeError);
  assert.throws(() => mskParts(undefined), TypeError);
});

// --- isWithinWorkingHours ---

test('isWithinWorkingHours: 09:00 МСК (06:00 UTC) → true (граница включительно)', () => {
  // Ровно 09:00 МСК — начало рабочего дня, включается.
  assert.equal(isWithinWorkingHours(new Date('2026-06-15T06:00:00Z')), true);
});

test('isWithinWorkingHours: 08:59 МСК (05:59 UTC) → false (до начала)', () => {
  assert.equal(isWithinWorkingHours(new Date('2026-06-15T05:59:00Z')), false);
});

test('isWithinWorkingHours: 17:59 МСК (14:59 UTC) → true (последняя минута рабочего дня)', () => {
  assert.equal(isWithinWorkingHours(new Date('2026-06-15T14:59:00Z')), true);
});

test('isWithinWorkingHours: 18:00 МСК (15:00 UTC) → false (граница исключительно)', () => {
  // Ровно 18:00 МСК — рабочий день закончился, не включается.
  assert.equal(isWithinWorkingHours(new Date('2026-06-15T15:00:00Z')), false);
});

test('isWithinWorkingHours: 18:01 МСК (15:01 UTC) → false (после конца)', () => {
  assert.equal(isWithinWorkingHours(new Date('2026-06-15T15:01:00Z')), false);
});

test('isWithinWorkingHours: 00:00 МСК следующего дня (21:00 UTC) → false (ночь)', () => {
  // 2026-06-15T21:00:00Z = 00:00 МСК 16.06.2026
  assert.equal(isWithinWorkingHours(new Date('2026-06-15T21:00:00Z')), false);
});

test('isWithinWorkingHours: 13:00 МСК (10:00 UTC) → true (середина дня)', () => {
  assert.equal(isWithinWorkingHours(new Date('2026-06-15T10:00:00Z')), true);
});

// --- nextRunAt ---

test('nextRunAt: возвращает Date', () => {
  const d = new Date('2026-06-15T07:00:00Z'); // 10:00 МСК
  const result = nextRunAt(d, 15);
  assert.ok(result instanceof Date, 'должен вернуть Date');
});

test('nextRunAt: 10:00 МСК + 15 мин = 10:15 МСК → внутри окна, возвращает date+15мин', () => {
  // 07:00 UTC = 10:00 МСК; кандидат 07:15 UTC = 10:15 МСК (внутри [09:00, 18:00))
  const d = new Date('2026-06-15T07:00:00Z');
  const result = nextRunAt(d, 15);
  const expected = new Date('2026-06-15T07:15:00Z');
  assert.equal(result.getTime(), expected.getTime(), 'результат должен быть date + 15 мин');
});

test('nextRunAt: 09:00 МСК + 30 мин = 09:30 МСК → внутри окна', () => {
  // 06:00 UTC = 09:00 МСК; кандидат 06:30 UTC = 09:30 МСК
  const d = new Date('2026-06-15T06:00:00Z');
  const result = nextRunAt(d, 30);
  const p = mskParts(result);
  assert.equal(p.hour, 9);
  assert.equal(p.minute, 30);
});

test('nextRunAt: 17:55 МСК + 15 мин = 18:10 МСК → за окном, следующий день 09:00 МСК', () => {
  // 14:55 UTC = 17:55 МСК; кандидат 15:10 UTC = 18:10 МСК (за окном)
  const d = new Date('2026-06-15T14:55:00Z');
  const result = nextRunAt(d, 15);
  const p = mskParts(result);
  assert.equal(p.hour, 9, 'результат должен быть 09:00 МСК');
  assert.equal(p.minute, 0);
  assert.equal(p.day, 16, 'должен быть следующий день (16.06)');
  assert.equal(p.month, 6);
});

test('nextRunAt: 17:55 МСК + 15 мин → результат является UTC-инстантом 06:00 UTC следующего дня', () => {
  const d = new Date('2026-06-15T14:55:00Z');
  const result = nextRunAt(d, 15);
  // 09:00 МСК 16.06.2026 = 06:00 UTC 16.06.2026
  assert.equal(result.toISOString(), '2026-06-16T06:00:00.000Z');
});

test('nextRunAt: ночь/раннее утро → кандидат всё ещё до 09:00 → СЕГОДНЯШНИЕ 09:00 МСК', () => {
  // 04:00 UTC = 07:00 МСК; +5 мин = 04:05 UTC = 07:05 МСК — до 09:00 → сегодня 09:00 МСК
  const d = new Date('2026-06-15T04:00:00Z');
  const result = nextRunAt(d, 5);
  const p = mskParts(result);
  assert.equal(p.hour, 9, 'результат должен быть 09:00 МСК');
  assert.equal(p.minute, 0);
  assert.equal(p.day, 15, 'должен быть тот же день (15.06) — ещё до начала рабочего дня');
});

test('nextRunAt: 07:00 МСК + 5 мин → 06:00 UTC того же дня', () => {
  // 04:00 UTC = 07:00 МСК; сегодня 09:00 МСК = 06:00 UTC
  const d = new Date('2026-06-15T04:00:00Z');
  const result = nextRunAt(d, 5);
  assert.equal(result.toISOString(), '2026-06-15T06:00:00.000Z');
});

test('nextRunAt: 18:00 МСК (граница исключительно) + 1 мин → следующий день 09:00 МСК', () => {
  // 15:00 UTC = 18:00 МСК (уже за окном); кандидат 15:01 UTC — тоже за окном
  const d = new Date('2026-06-15T15:00:00Z');
  const result = nextRunAt(d, 1);
  const p = mskParts(result);
  assert.equal(p.hour, 9);
  assert.equal(p.day, 16);
});

test('nextRunAt: intervalMinutes <=0 → 0 мин, кандидат = date (вне окна → ближайшие 09:00)', () => {
  // date = 20:00 МСК (17:00 UTC) — за окном; interval 0 → candidate = date → за окном → следующий день
  const d = new Date('2026-06-15T17:00:00Z'); // 20:00 МСК
  const result = nextRunAt(d, 0);
  const p = mskParts(result);
  assert.equal(p.hour, 9);
  assert.equal(p.day, 16);
});

test('nextRunAt: intervalMinutes = NaN → обрабатывается как 0', () => {
  const d = new Date('2026-06-15T07:00:00Z'); // 10:00 МСК — внутри окна
  const result = nextRunAt(d, NaN);
  // NaN → 0 мин → candidate = date = 10:00 МСК (внутри окна)
  assert.equal(result.getTime(), d.getTime());
});

test('nextRunAt: невалидный Date → выброс TypeError', () => {
  assert.throws(() => nextRunAt(new Date('invalid'), 15), TypeError);
});

test('nextRunAt: intervalMinutes = Infinity → обрабатывается как 0 (не Invalid Date)', () => {
  const d = new Date('2026-06-15T07:00:00Z'); // 10:00 МСК — внутри окна
  const result = nextRunAt(d, Infinity);
  assert.equal(result.getTime(), d.getTime());
});

test('nextRunAt: rollover через конец месяца (30 июня вечер → 1 июля 09:00 МСК)', () => {
  const d = new Date('2026-06-30T14:55:00Z'); // 17:55 МСК, за окном после +15
  const result = nextRunAt(d, 15);
  const p = mskParts(result);
  assert.equal(p.month, 7, 'месяц должен перейти на июль');
  assert.equal(p.day, 1, 'день должен стать 1');
  assert.equal(p.hour, 9);
});

test('nextRunAt: rollover через конец года (31 дек вечер → 1 янв 09:00 МСК)', () => {
  const d = new Date('2026-12-31T16:00:00Z'); // 19:00 МСК, за окном
  const result = nextRunAt(d, 30);
  const p = mskParts(result);
  assert.equal(p.year, 2027);
  assert.equal(p.month, 1);
  assert.equal(p.day, 1);
  assert.equal(p.hour, 9);
});

test('nextRunAt: раннее утро + интервал заводит внутрь окна → возвращает candidate', () => {
  const d = new Date('2026-06-15T05:50:00Z'); // 08:50 МСК
  const result = nextRunAt(d, 30); // 09:20 МСК — внутри окна
  assert.equal(result.getTime(), d.getTime() + 30 * 60 * 1000);
});
