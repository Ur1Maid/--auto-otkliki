import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_PHASES,
  ERROR_REASONS,
  normalizePhase,
  classifyErrorReason,
} from '../src/lib/runPhase.js';

// --- Константы ---

test('RUN_PHASES: канонические литералы фаз', () => {
  assert.equal(RUN_PHASES.COLLECTING, 'collecting');
  assert.equal(RUN_PHASES.SCORING, 'scoring');
  assert.equal(RUN_PHASES.APPLYING, 'applying');
  assert.equal(RUN_PHASES.DONE, 'done');
  assert.equal(RUN_PHASES.ERROR, 'error');
});

test('RUN_PHASES / ERROR_REASONS: заморожены (нельзя случайно мутировать)', () => {
  assert.ok(Object.isFrozen(RUN_PHASES));
  assert.ok(Object.isFrozen(ERROR_REASONS));
});

test('ERROR_REASONS: ожидаемые литералы', () => {
  assert.equal(ERROR_REASONS.TIMEOUT, 'timeout');
  assert.equal(ERROR_REASONS.NAVIGATION, 'navigation');
  assert.equal(ERROR_REASONS.NETWORK, 'network');
  assert.equal(ERROR_REASONS.DETACHED, 'detached');
  assert.equal(ERROR_REASONS.CLOSED, 'closed');
  assert.equal(ERROR_REASONS.UNKNOWN, 'unknown');
});

// --- normalizePhase ---

test('normalizePhase: распознаёт каждую каноническую фазу', () => {
  for (const phase of Object.values(RUN_PHASES)) {
    assert.equal(normalizePhase(phase), phase);
  }
});

test('normalizePhase: тримит и приводит регистр', () => {
  assert.equal(normalizePhase('  SCORING '), 'scoring');
  assert.equal(normalizePhase('Applying'), 'applying');
  assert.equal(normalizePhase('DONE'), 'done');
});

test('normalizePhase: неизвестное → дефолт scoring', () => {
  assert.equal(normalizePhase('review'), 'scoring');
  assert.equal(normalizePhase(''), 'scoring');
});

test('normalizePhase: кастомный fallback применяется только если валиден', () => {
  assert.equal(normalizePhase('xxx', RUN_PHASES.COLLECTING), 'collecting');
  // невалидный fallback → дефолт scoring
  assert.equal(normalizePhase('xxx', 'garbage'), 'scoring');
});

test('normalizePhase: не-строка / null / undefined → дефолт, не бросает', () => {
  assert.equal(normalizePhase(null), 'scoring');
  assert.equal(normalizePhase(undefined), 'scoring');
  assert.equal(normalizePhase(42), 'scoring');
  assert.equal(normalizePhase({}), 'scoring');
});

// --- classifyErrorReason ---

test('classifyErrorReason: TimeoutError → timeout', () => {
  const err = new Error('Timeout 30000ms exceeded.');
  err.name = 'TimeoutError';
  assert.equal(classifyErrorReason(err), 'timeout');
});

test('classifyErrorReason: сетевые ошибки → network', () => {
  assert.equal(classifyErrorReason(new Error('net::ERR_CONNECTION_RESET at https://hh.ru')), 'network');
  assert.equal(classifyErrorReason(new Error('fetch failed')), 'network');
  assert.equal(classifyErrorReason(new Error('ECONNRESET')), 'network');
});

test('classifyErrorReason: навигация → navigation', () => {
  assert.equal(classifyErrorReason(new Error('page.goto: navigation failed')), 'navigation');
});

test('classifyErrorReason: отвалившийся узел → detached', () => {
  assert.equal(classifyErrorReason(new Error('Element is not attached to the DOM')), 'detached');
});

test('classifyErrorReason: закрытый таргет → closed', () => {
  assert.equal(
    classifyErrorReason(new Error('Target page, context or browser has been closed')),
    'closed',
  );
});

test('classifyErrorReason: нераспознанное → unknown', () => {
  assert.equal(classifyErrorReason(new Error('что-то пошло не так')), 'unknown');
  assert.equal(classifyErrorReason(''), 'unknown');
  assert.equal(classifyErrorReason(null), 'unknown');
  assert.equal(classifyErrorReason(undefined), 'unknown');
  assert.equal(classifyErrorReason(123), 'unknown');
  assert.equal(classifyErrorReason({ message: 'timeout' }), 'unknown'); // не-Error объект не строкуется
});

// --- БЕЗОПАСНОСТЬ: сырой текст исключения (PII/URL) НИКОГДА не возвращается ---

test('classifyErrorReason: PII/URL из сообщения не утекает в результат', () => {
  const secretUrl = 'https://hh.ru/vacancy/12345?token=SECRET&email=user@example.com';
  const err = new Error(`Timeout 30000ms exceeded while waiting on ${secretUrl}`);
  const reason = classifyErrorReason(err);
  // результат — только литерал, ни URL, ни токена, ни почты
  assert.equal(reason, 'timeout');
  assert.ok(!reason.includes('hh.ru'));
  assert.ok(!reason.includes('SECRET'));
  assert.ok(!reason.includes('@'));
  assert.ok(Object.values(ERROR_REASONS).includes(reason));
});

test('classifyErrorReason: всегда возвращает литерал из ERROR_REASONS', () => {
  const inputs = [
    new Error('net::ERR_X'),
    new Error('detached'),
    new Error('Target closed'),
    new Error('random'),
    'plain string timeout',
    null,
    {},
    42,
  ];
  for (const input of inputs) {
    assert.ok(Object.values(ERROR_REASONS).includes(classifyErrorReason(input)));
  }
});
