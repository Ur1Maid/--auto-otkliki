import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_STATE_OK,
  RUN_STATE_CAPTCHA,
  RUN_STATE_STALLED,
  ANTIBOT_PATTERNS,
  detectAntiBot,
  detectStalledRun,
  resolveRunState,
} from '../src/lib/runState.js';
import { buildHeartbeat } from '../src/lib/heartbeat.js';

// Фиксированные моменты — детерминированы, Date.now() не используется.
const NOW = new Date('2026-06-30T12:00:00.000Z');

// --- Константы-литералы ---

test('RUN_STATE_*: литералы совпадают с полем heartbeat.state', () => {
  assert.equal(RUN_STATE_OK, 'ok');
  assert.equal(RUN_STATE_CAPTCHA, 'captcha');
  assert.equal(RUN_STATE_STALLED, 'stalled');
});

test('ANTIBOT_PATTERNS: непустой массив регэкспов', () => {
  assert.ok(Array.isArray(ANTIBOT_PATTERNS) && ANTIBOT_PATTERNS.length > 0);
  for (const re of ANTIBOT_PATTERNS) assert.ok(re instanceof RegExp);
});

// --- detectAntiBot: текст ---

test('detectAntiBot: «Подтвердите, что вы не робот» (инцидент belonogov) → true', () => {
  assert.equal(detectAntiBot('Подтвердите, что вы не робот, чтобы продолжить'), true);
  assert.equal(detectAntiBot('подтвердите что вы не робот'), true);
});

test('detectAntiBot: прочие антибот-формулировки → true', () => {
  assert.equal(detectAntiBot('Докажите, что вы не робот'), true);
  assert.equal(detectAntiBot('Я не робот'), true);
  assert.equal(detectAntiBot('Пройдите CAPTCHA'), true);
  assert.equal(detectAntiBot('Введите капчу'), true);
  assert.equal(detectAntiBot('Проверка безопасности'), true);
  assert.equal(detectAntiBot('Замечена подозрительная активность'), true);
});

test('detectAntiBot: обычный текст вакансии → false', () => {
  assert.equal(detectAntiBot('DevOps-инженер, требования: Docker, Kubernetes, CI/CD'), false);
  assert.equal(detectAntiBot('Откликнуться на вакансию'), false);
  // «робот» без отрицания не должен ложно срабатывать (RPA-вакансии и т.п.)
  assert.equal(detectAntiBot('Разработка промышленных роботов'), false);
});

test('detectAntiBot: сигнал-объект с text матчится', () => {
  assert.equal(detectAntiBot({ text: 'подтвердите, что вы не робот' }), true);
  assert.equal(detectAntiBot({ text: 'обычная вакансия' }), false);
});

test('detectAntiBot: явный булев флаг captcha/antiBot → true независимо от текста', () => {
  assert.equal(detectAntiBot({ captcha: true }), true);
  assert.equal(detectAntiBot({ antiBot: true }), true);
  assert.equal(detectAntiBot({ captcha: true, text: 'обычный текст' }), true);
  assert.equal(detectAntiBot({ captcha: false, text: 'обычный текст' }), false);
});

test('detectAntiBot: мусор/не-строка/null → false, не бросает', () => {
  assert.equal(detectAntiBot(null), false);
  assert.equal(detectAntiBot(undefined), false);
  assert.equal(detectAntiBot(42), false);
  assert.equal(detectAntiBot({}), false);
  assert.equal(detectAntiBot({ text: 123 }), false);
  assert.equal(detectAntiBot(''), false);
});

// --- detectStalledRun: зависание только В рабочем окне ---

test('detectStalledRun: устарел И в окне → true', () => {
  const hb = buildHeartbeat({ ts: new Date(NOW.getTime() - 180000) });
  assert.equal(detectStalledRun(hb, NOW, 120000, true), true);
});

test('detectStalledRun: устарел, но ВНЕ окна → false (простой ожидаем)', () => {
  const hb = buildHeartbeat({ ts: new Date(NOW.getTime() - 180000) });
  assert.equal(detectStalledRun(hb, NOW, 120000, false), false);
});

test('detectStalledRun: свежий хартбит в окне → false', () => {
  const hb = buildHeartbeat({ ts: new Date(NOW.getTime() - 60000) });
  assert.equal(detectStalledRun(hb, NOW, 120000, true), false);
});

test('detectStalledRun: withinWorkingHours не строго true → false', () => {
  const hb = buildHeartbeat({ ts: new Date(NOW.getTime() - 180000) });
  assert.equal(detectStalledRun(hb, NOW, 120000, undefined), false);
  assert.equal(detectStalledRun(hb, NOW, 120000, 1), false);
  assert.equal(detectStalledRun(hb, NOW, 120000, 'yes'), false);
});

test('detectStalledRun: thresholdMs опущен → DEFAULT (через isStale)', () => {
  const stale = buildHeartbeat({ ts: new Date(NOW.getTime() - 200000) });
  const fresh = buildHeartbeat({ ts: new Date(NOW.getTime() - 60000) });
  assert.equal(detectStalledRun(stale, NOW, undefined, true), true);
  assert.equal(detectStalledRun(fresh, NOW, undefined, true), false);
});

test('detectStalledRun: нет ts → устарел; в окне → true', () => {
  assert.equal(detectStalledRun({ task: 'apply' }, NOW, 120000, true), true);
  assert.equal(detectStalledRun(null, NOW, 120000, true), true);
});

test('detectStalledRun: невалидный now (isStale бросил бы) → false, не бросает', () => {
  const hb = buildHeartbeat({ ts: new Date(NOW.getTime() - 180000) });
  assert.equal(detectStalledRun(hb, new Date('invalid'), 120000, true), false);
  assert.equal(detectStalledRun(hb, 'не дата', 120000, true), false);
  assert.equal(detectStalledRun(hb, null, 120000, true), false);
});

// --- resolveRunState: сведение к литералу состояния ---

test('resolveRunState: капча → captcha (приоритет над зависанием)', () => {
  const staleHb = buildHeartbeat({ ts: new Date(NOW.getTime() - 180000) });
  assert.equal(
    resolveRunState({
      pageTextOrSignals: 'подтвердите, что вы не робот',
      heartbeat: staleHb,
      now: NOW,
      thresholdMs: 120000,
      withinWorkingHours: true,
    }),
    RUN_STATE_CAPTCHA,
  );
});

test('resolveRunState: stale-в-окне без капчи → stalled', () => {
  const staleHb = buildHeartbeat({ ts: new Date(NOW.getTime() - 180000) });
  assert.equal(
    resolveRunState({
      pageTextOrSignals: 'обычная вакансия',
      heartbeat: staleHb,
      now: NOW,
      thresholdMs: 120000,
      withinWorkingHours: true,
    }),
    RUN_STATE_STALLED,
  );
});

test('resolveRunState: свежий прогon → ok', () => {
  const freshHb = buildHeartbeat({ ts: new Date(NOW.getTime() - 60000) });
  assert.equal(
    resolveRunState({
      pageTextOrSignals: 'обычная вакансия',
      heartbeat: freshHb,
      now: NOW,
      thresholdMs: 120000,
      withinWorkingHours: true,
    }),
    RUN_STATE_OK,
  );
});

test('resolveRunState: stale, но ВНЕ окна → ok', () => {
  const staleHb = buildHeartbeat({ ts: new Date(NOW.getTime() - 180000) });
  assert.equal(
    resolveRunState({
      heartbeat: staleHb,
      now: NOW,
      thresholdMs: 120000,
      withinWorkingHours: false,
    }),
    RUN_STATE_OK,
  );
});

test('resolveRunState: мусор/нет аргументов → ok, не бросает', () => {
  assert.equal(resolveRunState(), RUN_STATE_OK);
  assert.equal(resolveRunState(null), RUN_STATE_OK);
  assert.equal(resolveRunState('строка'), RUN_STATE_OK);
  assert.equal(resolveRunState({}), RUN_STATE_OK);
});
