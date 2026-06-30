import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSAGE_OUTCOMES,
  classifyMessagesOutcome,
  isMessagesOutcome,
  messagesOutcomeLabel,
} from '../src/lib/messagesOutcome.js';

// --- Константы ---

test('MESSAGE_OUTCOMES: канонические литералы и заморожены', () => {
  assert.equal(MESSAGE_OUTCOMES.CHAT_NOT_FOUND, 'chat_not_found');
  assert.equal(MESSAGE_OUTCOMES.NO_NEW, 'no_new');
  assert.equal(MESSAGE_OUTCOMES.PROCESSED, 'processed');
  assert.ok(Object.isFrozen(MESSAGE_OUTCOMES));
});

// --- classifyMessagesOutcome ---

test('classifyMessagesOutcome: chatFound=false → chat_not_found (приоритет над processed)', () => {
  assert.equal(
    classifyMessagesOutcome({ chatFound: false, processed: 5 }),
    MESSAGE_OUTCOMES.CHAT_NOT_FOUND,
  );
});

test('classifyMessagesOutcome: чат найден, processed=0 → no_new', () => {
  assert.equal(
    classifyMessagesOutcome({ chatFound: true, processed: 0 }),
    MESSAGE_OUTCOMES.NO_NEW,
  );
});

test('classifyMessagesOutcome: чат найден, processed>0 → processed', () => {
  assert.equal(
    classifyMessagesOutcome({ chatFound: true, processed: 3 }),
    MESSAGE_OUTCOMES.PROCESSED,
  );
});

test('classifyMessagesOutcome: нет chatFound, processed>0 → processed', () => {
  assert.equal(classifyMessagesOutcome({ processed: 2 }), MESSAGE_OUTCOMES.PROCESSED);
});

test('classifyMessagesOutcome: never-throws на мусоре → no_new', () => {
  for (const bad of [null, undefined, 42, 'x', [], { processed: NaN }, { processed: 'a' }]) {
    assert.equal(classifyMessagesOutcome(bad), MESSAGE_OUTCOMES.NO_NEW);
  }
});

// --- isMessagesOutcome ---

test('isMessagesOutcome: распознаёт каждый литерал', () => {
  for (const v of Object.values(MESSAGE_OUTCOMES)) {
    assert.equal(isMessagesOutcome(v), true);
  }
});

test('isMessagesOutcome: чужие/мусорные значения → false', () => {
  for (const bad of ['finished', 'done', 'timeout', '', null, undefined, 1, {}]) {
    assert.equal(isMessagesOutcome(bad), false);
  }
});

// --- messagesOutcomeLabel ---

test('messagesOutcomeLabel: метки исхода', () => {
  assert.equal(messagesOutcomeLabel(MESSAGE_OUTCOMES.CHAT_NOT_FOUND), 'Чат не найден');
  assert.equal(messagesOutcomeLabel(MESSAGE_OUTCOMES.NO_NEW), 'Нет новых сообщений');
  assert.equal(messagesOutcomeLabel(MESSAGE_OUTCOMES.PROCESSED), 'Готово');
});

test('messagesOutcomeLabel: неизвестный литерал → нейтральное «Готово»', () => {
  for (const bad of ['nope', '', null, undefined, 7]) {
    assert.equal(messagesOutcomeLabel(bad), 'Готово');
  }
});
