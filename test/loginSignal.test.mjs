import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForLoginSignal,
  LOGIN_OUTCOMES,
  LOGIN_PHASES,
  DEFAULT_LOGIN_TIMEOUT_MS,
  DEFAULT_LOGIN_POLL_MS,
} from '../src/lib/loginSignal.js';

// Все тесты детерминированы: now/sleep инъектируются, без реальных таймеров и файлов.

// ---------------------------------------------------------------------------
// Вспомогательные фабрики
// ---------------------------------------------------------------------------

/** Мгновенный sleep-мок: фиксирует переданные ms. */
function makeSleep() {
  const calls = [];
  const fn = async (ms) => { calls.push(ms); };
  fn.calls = calls;
  return fn;
}

/** Часы, которые продвигаются на step каждый вызов now(). */
function makeClock(start = 0, step = 1000) {
  let t = start;
  return () => {
    const cur = t;
    t += step;
    return cur;
  };
}

// ---------------------------------------------------------------------------
// Константы/литералы
// ---------------------------------------------------------------------------

test('loginSignal: LOGIN_PHASES/LOGIN_OUTCOMES заморожены и содержат ожидаемые литералы', () => {
  assert.equal(LOGIN_PHASES.WAITING, 'login_waiting');
  assert.equal(LOGIN_PHASES.SAVED, 'login_saved');
  assert.equal(LOGIN_PHASES.TIMEOUT, 'login_timeout');
  assert.equal(LOGIN_PHASES.STOPPED, 'login_stopped');
  assert.equal(LOGIN_OUTCOMES.SAVED, 'saved');
  assert.equal(LOGIN_OUTCOMES.TIMEOUT, 'timeout');
  assert.equal(LOGIN_OUTCOMES.STOPPED, 'stopped');
  assert.ok(Object.isFrozen(LOGIN_PHASES));
  assert.ok(Object.isFrozen(LOGIN_OUTCOMES));
  assert.equal(DEFAULT_LOGIN_TIMEOUT_MS, 5 * 60 * 1000);
  assert.equal(DEFAULT_LOGIN_POLL_MS, 1000);
});

// ---------------------------------------------------------------------------
// isDone сразу true → saved, без сна
// ---------------------------------------------------------------------------

test('loginSignal: isDone сразу true → saved, sleep не вызывается', async () => {
  const sleep = makeSleep();
  const result = await waitForLoginSignal({
    isDone: () => true,
    now: makeClock(0, 0),
    sleep,
  });
  assert.equal(result.outcome, LOGIN_OUTCOMES.SAVED);
  assert.equal(sleep.calls.length, 0);
});

// ---------------------------------------------------------------------------
// isDone становится true на 3-й итерации → saved, 2 сна
// ---------------------------------------------------------------------------

test('loginSignal: isDone на 3-й проверке → saved после 2 снов', async () => {
  const sleep = makeSleep();
  let checks = 0;
  const result = await waitForLoginSignal({
    isDone: () => { checks += 1; return checks >= 3; },
    now: makeClock(0, 0), // время не двигается → таймаут не сработает
    sleep,
    pollMs: 250,
  });
  assert.equal(result.outcome, LOGIN_OUTCOMES.SAVED);
  assert.equal(checks, 3);
  assert.equal(sleep.calls.length, 2, 'два ожидания между тремя проверками');
  assert.deepEqual(sleep.calls, [250, 250], 'спим ровно pollMs');
});

// ---------------------------------------------------------------------------
// Таймаут: сигнала нет, время истекает → timeout (сессия не сохраняется)
// ---------------------------------------------------------------------------

test('loginSignal: сигнала нет, истёк timeoutMs → timeout', async () => {
  const sleep = makeSleep();
  const result = await waitForLoginSignal({
    isDone: () => false,
    now: makeClock(0, 1000), // +1000 мс на каждый now()
    sleep,
    timeoutMs: 3000,
    pollMs: 1000,
  });
  assert.equal(result.outcome, LOGIN_OUTCOMES.TIMEOUT);
});

// ---------------------------------------------------------------------------
// isStopped true → stopped
// ---------------------------------------------------------------------------

test('loginSignal: isStopped true → stopped (сессия не сохраняется)', async () => {
  const sleep = makeSleep();
  const result = await waitForLoginSignal({
    isDone: () => false,
    isStopped: () => true,
    now: makeClock(0, 0),
    sleep,
  });
  assert.equal(result.outcome, LOGIN_OUTCOMES.STOPPED);
  assert.equal(sleep.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Приоритет: done важнее stopped (оба true в одной итерации → saved)
// ---------------------------------------------------------------------------

test('loginSignal: done приоритетнее stopped', async () => {
  const result = await waitForLoginSignal({
    isDone: () => true,
    isStopped: () => true,
    now: makeClock(0, 0),
    sleep: makeSleep(),
  });
  assert.equal(result.outcome, LOGIN_OUTCOMES.SAVED);
});

// ---------------------------------------------------------------------------
// Никогда не бросает: сбой предиката трактуется как «сигнала нет»
// ---------------------------------------------------------------------------

test('loginSignal: бросающий isDone не роняет ожидание, идёт к таймауту', async () => {
  const result = await waitForLoginSignal({
    isDone: () => { throw new Error('fs race'); },
    now: makeClock(0, 5000),
    sleep: makeSleep(),
    timeoutMs: 3000,
  });
  assert.equal(result.outcome, LOGIN_OUTCOMES.TIMEOUT);
});

test('loginSignal: async-бросок isStopped проглатывается', async () => {
  let checks = 0;
  const result = await waitForLoginSignal({
    isDone: () => { checks += 1; return checks >= 2; },
    isStopped: async () => { throw new Error('boom'); },
    now: makeClock(0, 0),
    sleep: makeSleep(),
  });
  assert.equal(result.outcome, LOGIN_OUTCOMES.SAVED);
});

// ---------------------------------------------------------------------------
// Нормализация мусорных опций → дефолты, не виснет
// ---------------------------------------------------------------------------

test('loginSignal: мусорные timeoutMs/pollMs → дефолты (не виснет)', async () => {
  const sleep = makeSleep();
  // timeoutMs невалиден → DEFAULT (5 мин). now продвигается на минуту за вызов,
  // done срабатывает раньше таймаута → saved.
  let checks = 0;
  const result = await waitForLoginSignal({
    isDone: () => { checks += 1; return checks >= 2; },
    now: makeClock(0, 60000),
    sleep,
    timeoutMs: -1,
    pollMs: NaN,
  });
  assert.equal(result.outcome, LOGIN_OUTCOMES.SAVED);
  assert.deepEqual(sleep.calls, [DEFAULT_LOGIN_POLL_MS], 'невалидный pollMs → дефолт 1000');
});

test('loginSignal: без предикатов и с истёкшим временем → timeout (не виснет)', async () => {
  // Без isDone/isStopped, но с now-инъекцией за пределом дефолтного таймаута —
  // покрывает ветку опций-объекта без предикатов, завершается мгновенно.
  const result = await waitForLoginSignal({
    now: makeClock(0, 10 * 60 * 1000), // сразу за пределами дефолтного таймаута (5 мин)
    sleep: makeSleep(),
  });
  assert.equal(result.outcome, LOGIN_OUTCOMES.TIMEOUT);
});
