import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLiveView,
  accountLiveness,
  LIVENESS_WORKING,
  LIVENESS_STALLED,
  LIVENESS_CAPTCHA,
  LIVENESS_LIMIT,
  LIVENESS_IDLE,
} from '../src/lib/liveStatus.js';

// Фиксированный момент — детерминизм, без Date.now().
const NOW = 1700000000000;
const iso = (ms) => new Date(ms).toISOString();

// --- accountLiveness ---

test('accountLiveness: свежий хартбит → working', () => {
  const hb = { account: 'a', ts: iso(NOW - 1000) };
  assert.equal(accountLiveness(hb, { now: NOW, withinWorkingHours: true }), LIVENESS_WORKING);
});

test('accountLiveness: устаревший в рабочем окне → stalled', () => {
  const hb = { account: 'a', ts: iso(NOW - 5 * 60 * 1000) };
  assert.equal(
    accountLiveness(hb, { now: NOW, withinWorkingHours: true, thresholdMs: 120000 }),
    LIVENESS_STALLED,
  );
});

test('accountLiveness: устаревший вне рабочего окна → idle', () => {
  const hb = { account: 'a', ts: iso(NOW - 5 * 60 * 1000) };
  assert.equal(
    accountLiveness(hb, { now: NOW, withinWorkingHours: false, thresholdMs: 120000 }),
    LIVENESS_IDLE,
  );
});

test('accountLiveness: state=captcha → captcha (даже если свежий)', () => {
  const hb = { account: 'a', ts: iso(NOW - 1000), state: 'captcha' };
  assert.equal(accountLiveness(hb, { now: NOW, withinWorkingHours: true }), LIVENESS_CAPTCHA);
});

test('accountLiveness: state=limit → limit (даже если свежий) (M14.3)', () => {
  const hb = { account: 'a', ts: iso(NOW - 1000), state: 'limit' };
  assert.equal(accountLiveness(hb, { now: NOW, withinWorkingHours: true }), LIVENESS_LIMIT);
});

test('accountLiveness: captcha приоритетнее limit', () => {
  const hb = { account: 'a', ts: iso(NOW - 1000), state: 'captcha' };
  // оба «липких» — captcha проверяется первой
  assert.equal(accountLiveness(hb, { now: NOW, withinWorkingHours: true }), LIVENESS_CAPTCHA);
});

test('accountLiveness: phase=done → idle (завершён, не «работает»)', () => {
  const hb = { account: 'a', ts: iso(NOW - 1000), phase: 'done' };
  assert.equal(accountLiveness(hb, { now: NOW, withinWorkingHours: true }), LIVENESS_IDLE);
});

test('accountLiveness: нет хартбита → idle', () => {
  assert.equal(accountLiveness(null, { now: NOW, withinWorkingHours: true }), LIVENESS_IDLE);
  assert.equal(accountLiveness(undefined, { now: NOW }), LIVENESS_IDLE);
  assert.equal(accountLiveness('мусор', { now: NOW }), LIVENESS_IDLE);
});

test('accountLiveness: невалидный now → не working (консервативно stalled/idle)', () => {
  const hb = { account: 'a', ts: iso(NOW - 1000) };
  // невалидный now → isStale бросает → stale=true → внутри окна stalled
  assert.equal(accountLiveness(hb, { now: 'не-дата', withinWorkingHours: true }), LIVENESS_STALLED);
});

// --- buildLiveView: happy path ---

test('buildLiveView: сводит хартбиты, ресурсы и события', () => {
  const view = buildLiveView({
    accounts: ['belonogov', 'startsev'],
    heartbeats: [
      { account: 'belonogov', task: 'apply', phase: 'review', index: 50, total: 200, lastEvent: 'clicked', state: 'ok', ts: iso(NOW - 1000) },
    ],
    resources: [
      { ts: iso(NOW - 2000), rssMb: 100, heapMb: 50, cpuPercent: 10, openContexts: 1 },
      { ts: iso(NOW - 1000), rssMb: 120, heapMb: 60, cpuPercent: 30, openContexts: 2 },
    ],
    eventsByAccount: {
      belonogov: [
        { status: 'skipped', at: iso(NOW - 3000), title: 'СЕКРЕТ', url: 'http://x' },
        { status: 'clicked', at: iso(NOW - 1000), title: 'СЕКРЕТ', url: 'http://y' },
      ],
    },
    now: NOW,
    withinWorkingHours: true,
    thresholdMs: 120000,
  });

  assert.equal(view.accounts.length, 2);
  const bel = view.accounts.find((a) => a.account === 'belonogov');
  assert.equal(bel.task, 'apply');
  assert.equal(bel.liveness, LIVENESS_WORKING);
  assert.equal(bel.progressPct, 25); // 50/200
  assert.equal(bel.ageMs, 1000);
  // события санитизированы: только status/at, последние сверху, без title/url
  assert.equal(bel.recentEvents.length, 2);
  assert.equal(bel.recentEvents[0].status, 'clicked');
  assert.equal('title' in bel.recentEvents[0], false);
  assert.equal('url' in bel.recentEvents[0], false);

  // аккаунт без хартбита → idle
  const st = view.accounts.find((a) => a.account === 'startsev');
  assert.equal(st.liveness, LIVENESS_IDLE);
  assert.equal(st.ts, null);

  // ресурсы: latest = последний, recent — последние сверху
  assert.equal(view.resources.latest.rssMb, 120);
  assert.equal(view.resources.recent[0].rssMb, 120);
  assert.equal(view.resources.recent.length, 2);

  assert.equal(view.generatedAt, iso(NOW));
});

test('buildLiveView: аккаунт из хартбита, отсутствующий в accounts, всё равно появляется', () => {
  const view = buildLiveView({
    accounts: [],
    heartbeats: [{ account: 'ghost', task: 'messages', ts: iso(NOW - 1000) }],
    now: NOW,
    withinWorkingHours: true,
  });
  assert.equal(view.accounts.length, 1);
  assert.equal(view.accounts[0].account, 'ghost');
});

test('buildLiveView: аккаунты отсортированы по имени', () => {
  const view = buildLiveView({
    accounts: ['zeta', 'alpha', 'mike'],
    now: NOW,
  });
  assert.deepEqual(view.accounts.map((a) => a.account), ['alpha', 'mike', 'zeta']);
});

test('buildLiveView: eventsLimit ограничивает число событий', () => {
  const events = Array.from({ length: 20 }, (_, i) => ({ status: 's' + i, at: iso(NOW - i) }));
  const view = buildLiveView({
    accounts: ['a'],
    heartbeats: [{ account: 'a', ts: iso(NOW) }],
    eventsByAccount: { a: events },
    eventsLimit: 3,
    now: NOW,
  });
  assert.equal(view.accounts[0].recentEvents.length, 3);
});

// --- guard cases ---

test('buildLiveView: пустой вход → пустой снимок, не бросает', () => {
  const view = buildLiveView();
  assert.deepEqual(view.accounts, []);
  assert.equal(view.resources.latest, null);
  assert.deepEqual(view.resources.recent, []);
  assert.equal(view.generatedAt, null);
});

test('buildLiveView: мусорные хартбиты/ресурсы пропускаются', () => {
  const view = buildLiveView({
    accounts: ['a'],
    heartbeats: [null, 'строка', 42, { account: 'a', ts: iso(NOW) }],
    resources: [null, 'x', { ts: iso(NOW), rssMb: 5 }],
    now: NOW,
  });
  assert.equal(view.accounts.length, 1);
  assert.equal(view.resources.recent.length, 1);
});

test('buildLiveView: progressPct null при total<=0 или нет данных', () => {
  const view = buildLiveView({
    heartbeats: [
      { account: 'a', index: 5, total: 0, ts: iso(NOW) },
      { account: 'b', total: 100, ts: iso(NOW) },
    ],
    now: NOW,
  });
  const a = view.accounts.find((x) => x.account === 'a');
  const b = view.accounts.find((x) => x.account === 'b');
  assert.equal(a.progressPct, null);
  assert.equal(b.progressPct, null); // index отсутствует
});

// --- per-task heartbeats (M12.6) ---

test('buildLiveView: три задачи одного аккаунта не перетирают друг друга (per-task)', () => {
  const view = buildLiveView({
    heartbeats: [
      { account: 'acc', task: 'apply',    phase: 'applying', index: 3, total: 10, ts: iso(NOW - 1000) },
      { account: 'acc', task: 'messages', phase: 'scoring',  index: 1, total: 5,  ts: iso(NOW - 2000) },
      { account: 'acc', task: 'resume',   phase: 'collecting', index: 0, total: 1, ts: iso(NOW - 3000) },
    ],
    now: NOW,
    withinWorkingHours: true,
    thresholdMs: 120000,
  });

  // Один аккаунт в списке.
  assert.equal(view.accounts.length, 1);
  const acc = view.accounts[0];

  // Три задачи, отсортированные по имени.
  assert.equal(acc.tasks.length, 3);
  assert.deepEqual(acc.tasks.map((t) => t.task), ['apply', 'messages', 'resume']);

  // Каждая задача несёт собственные поля.
  const applyTask = acc.tasks.find((t) => t.task === 'apply');
  const messagesTask = acc.tasks.find((t) => t.task === 'messages');
  const resumeTask = acc.tasks.find((t) => t.task === 'resume');
  assert.equal(applyTask.phase, 'applying');
  assert.equal(applyTask.progressPct, 30); // 3/10
  assert.equal(messagesTask.phase, 'scoring');
  assert.equal(messagesTask.progressPct, 20); // 1/5
  assert.equal(resumeTask.phase, 'collecting');

  // Верхнеуровневый представитель = самая свежая задача (apply, NOW-1000).
  assert.equal(acc.task, 'apply');
  assert.equal(acc.phase, 'applying');
});

test('buildLiveView: один хартбит на аккаунт → tasks.length === 1', () => {
  const view = buildLiveView({
    heartbeats: [
      { account: 'solo', task: 'apply', phase: 'scoring', index: 5, total: 20, ts: iso(NOW - 500) },
    ],
    now: NOW,
  });
  assert.equal(view.accounts.length, 1);
  const solo = view.accounts[0];
  assert.equal(solo.tasks.length, 1);
  assert.equal(solo.tasks[0].task, 'apply');
  // Верхнеуровневые поля = единственная задача.
  assert.equal(solo.task, 'apply');
  assert.equal(solo.progressPct, 25); // 5/20
});

// --- counts passthrough (M17.3) ---

test('buildLiveView: хартбит с counts → снимок аккаунта и tasks[0] содержат counts', () => {
  const counts = {
    viewed: 10, sent: 5, skipped: 3, manual: 1, alreadyApplied: 2, errors: 0,
    tokens: { calls: 7, promptTokens: 100, completionTokens: 50, totalTokens: 150, cacheHitTokens: 20, estimatedCostUsd: 0.01 },
  };
  const view = buildLiveView({
    heartbeats: [{ account: 'acc', task: 'apply', phase: 'scoring', ts: iso(NOW - 500), counts }],
    now: NOW,
  });
  const acc = view.accounts[0];
  // Верхнеуровневый представитель несёт counts.
  assert.deepEqual(acc.counts, counts);
  // tasks[0] тоже несёт counts.
  assert.deepEqual(acc.tasks[0].counts, counts);
});

test('buildLiveView: хартбит без counts → counts === null', () => {
  const view = buildLiveView({
    heartbeats: [{ account: 'acc', task: 'apply', ts: iso(NOW - 500) }],
    now: NOW,
  });
  assert.equal(view.accounts[0].counts, null);
  assert.equal(view.accounts[0].tasks[0].counts, null);
});

test('buildLiveView: null heartbeat (idle аккаунт) → counts === null', () => {
  const view = buildLiveView({ accounts: ['idle-acc'], now: NOW });
  assert.equal(view.accounts[0].counts, null);
});
