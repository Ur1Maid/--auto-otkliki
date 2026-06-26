import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSAGES_POLL_MINUTES,
  MICRO_EDIT_MINUTES,
  ACTIONS,
  decideNextAction,
} from '../src/lib/daemonPlan.js';

// Фиксированные момены времени — детерминированы, Date.now() не используется.
//
// МСК = UTC+3. Рабочие часы МСК: [9, 18).
//   INSIDE:  2026-06-26T09:00:00Z = 12:00 МСК — внутри рабочего окна.
//   OUTSIDE: 2026-06-26T20:00:00Z = 23:00 МСК — вне рабочего окна.
const INSIDE  = new Date('2026-06-26T09:00:00.000Z');  // 12:00 МСК
const OUTSIDE = new Date('2026-06-26T20:00:00.000Z');  // 23:00 МСК

// Вспомогательная функция: дата на N минут раньше базовой точки.
function minsBefore(base, n) {
  return new Date(base.getTime() - n * 60 * 1000);
}

// --- CONSTANTS ---

test('MESSAGES_POLL_MINUTES: равна 15', () => {
  assert.equal(MESSAGES_POLL_MINUTES, 15);
});

test('MICRO_EDIT_MINUTES: равна 30', () => {
  assert.equal(MICRO_EDIT_MINUTES, 30);
});

test('ACTIONS: заморожен и содержит все ожидаемые ключи', () => {
  assert.equal(ACTIONS.STOP, 'stop');
  assert.equal(ACTIONS.APPLY_RUN, 'apply_run');
  assert.equal(ACTIONS.POLL_MESSAGES, 'poll_messages');
  assert.equal(ACTIONS.MICRO_EDIT, 'micro_edit');
  assert.equal(ACTIONS.IDLE, 'idle');
  assert.throws(() => { ACTIONS.NEW_KEY = 'x'; });
});

// --- STOP: вне рабочих часов ---

test('STOP: вне рабочих часов → action=stop (даже если startup не сделан)', () => {
  const result = decideNextAction({ now: OUTSIDE, state: {}, config: {} });
  assert.equal(result.action, ACTIONS.STOP);
  assert.equal(result.reason, 'outside_working_hours');
});

test('STOP: вне рабочих часов при startupDone:false → всё равно STOP', () => {
  const result = decideNextAction({ now: OUTSIDE, state: { startupDone: false } });
  assert.equal(result.action, ACTIONS.STOP);
});

// --- APPLY_RUN: стартовый прогон ---

test('APPLY_RUN: внутри окна + startupDone отсутствует → apply_run', () => {
  const result = decideNextAction({ now: INSIDE, state: {}, config: {} });
  assert.equal(result.action, ACTIONS.APPLY_RUN);
  assert.equal(result.reason, 'startup');
});

test('APPLY_RUN: внутри окна + startupDone:false → apply_run', () => {
  const result = decideNextAction({ now: INSIDE, state: { startupDone: false } });
  assert.equal(result.action, ACTIONS.APPLY_RUN);
});

test('APPLY_RUN: внутри окна + startupDone:undefined → apply_run', () => {
  const result = decideNextAction({ now: INSIDE, state: { startupDone: undefined } });
  assert.equal(result.action, ACTIONS.APPLY_RUN);
});

// --- POLL_MESSAGES: поллинг сообщений ---

test('POLL_MESSAGES: startup сделан + lastMessagesPollAt null → poll_messages', () => {
  const state = { startupDone: true, lastMessagesPollAt: null, lastMicroEditAt: null };
  const result = decideNextAction({ now: INSIDE, state });
  assert.equal(result.action, ACTIONS.POLL_MESSAGES);
  assert.equal(result.reason, 'messages_due');
});

test('POLL_MESSAGES: startup сделан + lastMessagesPollAt undefined → poll_messages', () => {
  const state = { startupDone: true };
  const result = decideNextAction({ now: INSIDE, state });
  assert.equal(result.action, ACTIONS.POLL_MESSAGES);
});

test('POLL_MESSAGES: оба due (оба null) → poll_messages (приоритет перед micro_edit)', () => {
  const state = {
    startupDone: true,
    lastMessagesPollAt: null,
    lastMicroEditAt: null,
  };
  const result = decideNextAction({ now: INSIDE, state });
  assert.equal(result.action, ACTIONS.POLL_MESSAGES);
});

test('POLL_MESSAGES: граница каденции — ровно 15 мин назад → poll_messages (включительно)', () => {
  const lastPoll = minsBefore(INSIDE, MESSAGES_POLL_MINUTES); // ровно 15 мин назад
  const state = {
    startupDone: true,
    lastMessagesPollAt: lastPoll,
    lastMicroEditAt: null,  // null → micro_edit due, но poll_messages приоритетнее
  };
  const result = decideNextAction({ now: INSIDE, state });
  assert.equal(result.action, ACTIONS.POLL_MESSAGES);
});

// --- MICRO_EDIT: микро-правки ---

test('MICRO_EDIT: startup сделан + сообщения 5 мин назад + micro никогда → micro_edit', () => {
  const state = {
    startupDone: true,
    lastMessagesPollAt: minsBefore(INSIDE, 5),  // 5 мин < 15 → не due
    lastMicroEditAt: null,                        // никогда → due
  };
  const result = decideNextAction({ now: INSIDE, state });
  assert.equal(result.action, ACTIONS.MICRO_EDIT);
  assert.equal(result.reason, 'micro_edit_due');
});

test('MICRO_EDIT: граница каденции — ровно 30 мин с последней правки → micro_edit', () => {
  const state = {
    startupDone: true,
    lastMessagesPollAt: minsBefore(INSIDE, 5),           // не due
    lastMicroEditAt: minsBefore(INSIDE, MICRO_EDIT_MINUTES), // ровно 30 мин → due
  };
  const result = decideNextAction({ now: INSIDE, state });
  assert.equal(result.action, ACTIONS.MICRO_EDIT);
});

// --- IDLE: ничего не нужно ---

test('IDLE: оба недавно (сообщения 5 мин, микро 5 мин назад) → idle с nextCheckInMinutes', () => {
  const state = {
    startupDone: true,
    lastMessagesPollAt: minsBefore(INSIDE, 5),  // 5 мин < 15 → не due
    lastMicroEditAt: minsBefore(INSIDE, 5),      // 5 мин < 30 → не due
  };
  const result = decideNextAction({ now: INSIDE, state });
  assert.equal(result.action, ACTIONS.IDLE);
  assert.equal(result.reason, 'nothing_due');
  // min(15-5, 30-5) = min(10, 25) = 10
  assert.ok(result.nextCheckInMinutes > 0, 'nextCheckInMinutes должен быть > 0');
  assert.ok(
    Math.abs(result.nextCheckInMinutes - 10) < 0.01,
    `ожидалось ~10, получено ${result.nextCheckInMinutes}`,
  );
});

test('IDLE: nextCheckInMinutes никогда не отрицателен', () => {
  // Оба almost-due: 14 мин назад для сообщений, 29 мин для микро
  const state = {
    startupDone: true,
    lastMessagesPollAt: minsBefore(INSIDE, 14),
    lastMicroEditAt: minsBefore(INSIDE, 29),
  };
  const result = decideNextAction({ now: INSIDE, state });
  assert.equal(result.action, ACTIONS.IDLE);
  assert.ok(result.nextCheckInMinutes >= 0, 'nextCheckInMinutes не должен быть отрицательным');
});

// --- НЕ POLL_MESSAGES за 1 мин до каденции ---

test('за 1 мин до каденции (14 мин) → не POLL_MESSAGES, и если микро тоже не due → IDLE', () => {
  const state = {
    startupDone: true,
    lastMessagesPollAt: minsBefore(INSIDE, 14),  // 14 мин < 15 → не due
    lastMicroEditAt: minsBefore(INSIDE, 5),       // 5 мин < 30 → не due
  };
  const result = decideNextAction({ now: INSIDE, state });
  assert.notEqual(result.action, ACTIONS.POLL_MESSAGES);
  assert.equal(result.action, ACTIONS.IDLE);
});

// --- КАСТОМНЫЙ CONFIG ---

test('кастомный config (messagesPollMinutes:10) уважается', () => {
  const state = {
    startupDone: true,
    lastMessagesPollAt: minsBefore(INSIDE, 10),  // ровно 10 мин → due при cadence=10
    lastMicroEditAt: minsBefore(INSIDE, 5),
  };
  const result = decideNextAction({
    now: INSIDE,
    state,
    config: { messagesPollMinutes: 10 },
  });
  assert.equal(result.action, ACTIONS.POLL_MESSAGES);
});

test('кастомный config (microEditMinutes:10) уважается', () => {
  const state = {
    startupDone: true,
    lastMessagesPollAt: minsBefore(INSIDE, 5),   // не due
    lastMicroEditAt: minsBefore(INSIDE, 10),      // ровно 10 мин → due при cadence=10
  };
  const result = decideNextAction({
    now: INSIDE,
    state,
    config: { microEditMinutes: 10 },
  });
  assert.equal(result.action, ACTIONS.MICRO_EDIT);
});

// --- МУСОРНЫЙ CONFIG → дефолты ---

test('мусорный config (строки) → используются дефолты MESSAGES_POLL_MINUTES и MICRO_EDIT_MINUTES', () => {
  const state = {
    startupDone: true,
    // ровно 15 мин назад → due только при дефолте 15
    lastMessagesPollAt: minsBefore(INSIDE, MESSAGES_POLL_MINUTES),
    lastMicroEditAt: minsBefore(INSIDE, 5),
  };
  const result = decideNextAction({
    now: INSIDE,
    state,
    config: { messagesPollMinutes: 'нет', microEditMinutes: null },
  });
  assert.equal(result.action, ACTIONS.POLL_MESSAGES);
});

test('мусорный config (не-объект: строка) → используются дефолты', () => {
  const state = {
    startupDone: true,
    lastMessagesPollAt: minsBefore(INSIDE, MESSAGES_POLL_MINUTES),
    lastMicroEditAt: minsBefore(INSIDE, 5),
  };
  const result = decideNextAction({ now: INSIDE, state, config: 'bad' });
  assert.equal(result.action, ACTIONS.POLL_MESSAGES);
});

// --- STATE НЕ ОБЪЕКТ ---

test('state=null → трактуется как {} → (внутри окна) APPLY_RUN', () => {
  const result = decideNextAction({ now: INSIDE, state: null });
  assert.equal(result.action, ACTIONS.APPLY_RUN);
});

test('state=42 (число) → трактуется как {} → (внутри окна) APPLY_RUN', () => {
  const result = decideNextAction({ now: INSIDE, state: 42 });
  assert.equal(result.action, ACTIONS.APPLY_RUN);
});

test('state="строка" → трактуется как {} → (внутри окна) APPLY_RUN', () => {
  const result = decideNextAction({ now: INSIDE, state: 'не объект' });
  assert.equal(result.action, ACTIONS.APPLY_RUN);
});

// --- GUARD: невалидный now → TypeError ---

test('now=undefined → throws TypeError', () => {
  assert.throws(
    () => decideNextAction({ now: undefined }),
    TypeError,
  );
});

test('now=null → throws TypeError', () => {
  assert.throws(
    () => decideNextAction({ now: null }),
    TypeError,
  );
});

test('now=число → throws TypeError', () => {
  assert.throws(
    () => decideNextAction({ now: Date.now() }),
    TypeError,
  );
});

test('now=Invalid Date → throws TypeError', () => {
  assert.throws(
    () => decideNextAction({ now: new Date('invalid') }),
    TypeError,
  );
});

test('аргументы не переданы вовсе (default={}) → throws TypeError из-за now', () => {
  assert.throws(
    () => decideNextAction(),
    TypeError,
  );
});

// --- СТРУКТУРА ВОЗВРАЩАЕМОГО ОБЪЕКТА ---

test('результат IDLE содержит nextCheckInMinutes, остальные не содержат', () => {
  const idleState = {
    startupDone: true,
    lastMessagesPollAt: minsBefore(INSIDE, 5),
    lastMicroEditAt: minsBefore(INSIDE, 5),
  };
  const idle = decideNextAction({ now: INSIDE, state: idleState });
  assert.ok('nextCheckInMinutes' in idle, 'IDLE должен содержать nextCheckInMinutes');

  const stop = decideNextAction({ now: OUTSIDE });
  assert.ok(!('nextCheckInMinutes' in stop), 'STOP не должен содержать nextCheckInMinutes');

  const applyRun = decideNextAction({ now: INSIDE, state: {} });
  assert.ok(!('nextCheckInMinutes' in applyRun), 'APPLY_RUN не должен содержать nextCheckInMinutes');
});
