import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectMetrics, collectLive, listAccounts } from '../src/lib/dashboardData.js';
import { handleStart, handleStop, handleLoginDone, handleTasks } from '../src/lib/dashboardActions.js';

// --- collectMetrics (smoke: читает реальный logs/, не должен бросать) ---
test('collectMetrics: возвращает агрегаты с нужными ключами, не бросает', async () => {
  const m = await collectMetrics();
  for (const key of ['responses', 'summary', 'daily', 'tokenTotals', 'estCostUsd', 'funnel', 'generatedAt']) {
    assert.ok(key in m, `нет ключа ${key}`);
  }
  assert.ok(Array.isArray(m.funnel.stages));
  assert.equal(typeof m.estCostUsd, 'number');
});

// --- collectLive (smoke: читает реальный logs/, не бросает) ---
test('collectLive: возвращает живой снимок с нужными ключами, не бросает', async () => {
  const v = await collectLive();
  for (const key of ['accounts', 'resources', 'generatedAt']) {
    assert.ok(key in v, `нет ключа ${key}`);
  }
  assert.ok(Array.isArray(v.accounts));
  assert.ok('latest' in v.resources && 'recent' in v.resources);
  assert.ok(Array.isArray(v.resources.recent));
});

// --- listAccounts (источник аккаунтов для блока «Управление» M11.10) ---
const dirent = (name, isDir = true) => ({ name, isDirectory: () => isDir });

test('listAccounts: только каталоги, без example/default/скрытых, отсортировано', async () => {
  const readdirFn = async () => [
    dirent('startsev'), dirent('belonogov'), dirent('example'), dirent('default'),
    dirent('.keep'), dirent('readme.txt', false),
  ];
  assert.deepEqual(await listAccounts({ readdirFn }), ['belonogov', 'startsev']);
});

test('listAccounts: readdir бросает → []', async () => {
  const readdirFn = async () => { throw new Error('ENOENT'); };
  assert.deepEqual(await listAccounts({ readdirFn }), []);
});

test('listAccounts: не-массив → []', async () => {
  const readdirFn = async () => null;
  assert.deepEqual(await listAccounts({ readdirFn }), []);
});

// ============================================================
// handleStart / handleStop / handleTasks (было POST /api/start и /api/stop, GET /api/tasks) —
// теперь чистые обработчики поверх инъецированного runner-стаба, без HTTP/сервера.
// ============================================================

test('handleStart: проксирует в runner.start и возвращает status/тело', () => {
  const calls = [];
  const runner = {
    start: (opts) => { calls.push(opts); return { ok: true, status: 200, account: opts.account, task: opts.task, pid: 1, live: opts.live }; },
    stop: () => ({ ok: false, status: 404 }),
    list: () => [],
  };
  const { status, body } = handleStart(runner, { task: 'messages', account: 'acc1' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.account, 'acc1');
  // status не дублируется в тело.
  assert.equal('status' in body, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].live, false); // дефолт dry-run
});

test('handleStart: live прокидывается только как строгий true', () => {
  const seen = [];
  const runner = { start: (o) => { seen.push(o.live); return { ok: true, status: 200 }; }, stop: () => ({}), list: () => [] };
  handleStart(runner, { task: 'apply', account: 'a', live: 'yes' });
  handleStart(runner, { task: 'apply', account: 'a', live: true });
  assert.deepEqual(seen, [false, true]);
});

test('handleStart: дубль возвращает 409 из runner', () => {
  const runner = { start: () => ({ ok: false, status: 409, reason: 'занят' }), stop: () => ({}), list: () => [] };
  const { status, body } = handleStart(runner, { task: 'messages', account: 'acc1' });
  assert.equal(status, 409);
  assert.equal(body.ok, false);
});

test('handleStop: проксирует в runner.stop', () => {
  const calls = [];
  const runner = { start: () => ({}), stop: (o) => { calls.push(o); return { ok: true, status: 200, account: o.account, task: 'messages' }; }, list: () => [] };
  const { status, body } = handleStop(runner, { account: 'acc1' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(calls, [{ account: 'acc1' }]);
});

test('handleStop: с task-фильтром проксирует task в runner.stop (M12.7)', () => {
  const calls = [];
  const runner = { start: () => ({}), stop: (o) => { calls.push(o); return { ok: true, status: 200, account: o.account, task: o.task }; }, list: () => [] };
  const { status } = handleStop(runner, { account: 'acc1', task: 'apply' });
  assert.equal(status, 200);
  assert.deepEqual(calls, [{ account: 'acc1', task: 'apply' }]);
});

test('handleTasks: отдаёт снимок runner.list', () => {
  const runner = { start: () => ({}), stop: () => ({}), list: () => [{ account: 'acc1', task: 'messages', pid: 9, live: false, startedAt: 1 }] };
  const { status, body } = handleTasks(runner);
  assert.equal(status, 200);
  assert.equal(body.tasks.length, 1);
  assert.equal(body.tasks[0].account, 'acc1');
});

// ============================================================
// handleLoginDone (M19.5): sentinel завершения панельного логина
// ============================================================

test('handleLoginDone: с account → 200, вызывает writeLoginDone(account)', async () => {
  const called = [];
  const writeLoginDone = async (acc) => { called.push(acc); };
  const { status, body } = await handleLoginDone(writeLoginDone, { account: 'acc1' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.account, 'acc1');
  assert.deepEqual(called, ['acc1'], 'writeLoginDone должен быть вызван с acc1');
});

test('handleLoginDone: пустой account → 400, writeLoginDone не вызывается', async () => {
  const called = [];
  const writeLoginDone = async (acc) => { called.push(acc); };
  const { status, body } = await handleLoginDone(writeLoginDone, { account: '' });
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.equal(called.length, 0, 'writeLoginDone не должен вызываться при пустом account');
});

test('handleLoginDone: отсутствующий account → 400, writeLoginDone не вызывается', async () => {
  const called = [];
  const writeLoginDone = async (acc) => { called.push(acc); };
  const { status, body } = await handleLoginDone(writeLoginDone, {});
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.equal(called.length, 0);
});

test('handleLoginDone: writeLoginDone бросает → 500', async () => {
  const writeLoginDone = async () => { throw new Error('диск заполнен'); };
  const { status, body } = await handleLoginDone(writeLoginDone, { account: 'acc1' });
  assert.equal(status, 500);
  assert.equal(body.ok, false);
});
