import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePort, collectMetrics, collectLive, createServer, isLoopbackRequest, listAccounts } from '../src/dashboard.js';

// --- parsePort ---
test('parsePort: дефолт 8787', () => {
  const saved = process.env.DASHBOARD_PORT;
  delete process.env.DASHBOARD_PORT;
  assert.equal(parsePort([]), 8787);
  if (saved !== undefined) process.env.DASHBOARD_PORT = saved;
});

test('parsePort: --port задаёт порт', () => {
  assert.equal(parsePort(['--port', '9000']), 9000);
});

test('parsePort: мусорный --port → дефолт', () => {
  const saved = process.env.DASHBOARD_PORT;
  delete process.env.DASHBOARD_PORT;
  assert.equal(parsePort(['--port', 'abc']), 8787);
  assert.equal(parsePort(['--port', '0']), 8787);
  assert.equal(parsePort(['--port', '70000']), 8787);
  if (saved !== undefined) process.env.DASHBOARD_PORT = saved;
});

test('parsePort: env DASHBOARD_PORT', () => {
  const saved = process.env.DASHBOARD_PORT;
  process.env.DASHBOARD_PORT = '5555';
  assert.equal(parsePort([]), 5555);
  if (saved === undefined) delete process.env.DASHBOARD_PORT;
  else process.env.DASHBOARD_PORT = saved;
});

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

test('createServer: GET /api/live → 200 JSON', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/live`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok('accounts' in json);
    assert.ok(Array.isArray(json.accounts));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// --- createServer (smoke: /api/metrics отдаёт валидный JSON) ---
test('createServer: GET /api/metrics → 200 JSON', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/metrics`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok('responses' in json);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer: GET / → 200 HTML', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('hh-auto-otkliki'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// --- Управляющий слой M11.8 (через инъецированный фейковый runner) ---

/** Поднимает сервер на loopback с инъецированным runner; вызывает fn(baseUrl). */
async function withServer(runner, fn) {
  const server = createServer({ runner });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('POST /api/start: проксирует в runner.start и возвращает status/тело', async () => {
  const calls = [];
  const runner = {
    start: (opts) => { calls.push(opts); return { ok: true, status: 200, account: opts.account, task: opts.task, pid: 1, live: opts.live }; },
    stop: () => ({ ok: false, status: 404 }),
    list: () => [],
  };
  await withServer(runner, async (base) => {
    const res = await fetch(`${base}/api/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'messages', account: 'acc1' }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.account, 'acc1');
    // status не дублируется в тело.
    assert.equal('status' in json, false);
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].live, false); // дефолт dry-run
});

test('POST /api/start: live прокидывается только как строгий true', async () => {
  const seen = [];
  const runner = { start: (o) => { seen.push(o.live); return { ok: true, status: 200 }; }, stop: () => ({}), list: () => [] };
  await withServer(runner, async (base) => {
    await fetch(`${base}/api/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: 'apply', account: 'a', live: 'yes' }) });
    await fetch(`${base}/api/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: 'apply', account: 'a', live: true }) });
  });
  assert.deepEqual(seen, [false, true]);
});

test('POST /api/start: дубль возвращает 409 из runner', async () => {
  const runner = { start: () => ({ ok: false, status: 409, reason: 'занят' }), stop: () => ({}), list: () => [] };
  await withServer(runner, async (base) => {
    const res = await fetch(`${base}/api/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: 'messages', account: 'acc1' }) });
    assert.equal(res.status, 409);
    const json = await res.json();
    assert.equal(json.ok, false);
  });
});

test('POST /api/start: битый JSON → 400', async () => {
  const runner = { start: () => { throw new Error('не должно вызваться'); }, stop: () => ({}), list: () => [] };
  await withServer(runner, async (base) => {
    const res = await fetch(`${base}/api/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{не json' });
    assert.equal(res.status, 400);
  });
});

test('POST /api/stop: проксирует в runner.stop', async () => {
  const calls = [];
  const runner = { start: () => ({}), stop: (o) => { calls.push(o); return { ok: true, status: 200, account: o.account, task: 'messages' }; }, list: () => [] };
  await withServer(runner, async (base) => {
    const res = await fetch(`${base}/api/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: 'acc1' }) });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
  });
  assert.deepEqual(calls, [{ account: 'acc1' }]);
});

// --- listAccounts (источник аккаунтов для блока «Управление» M11.10) ---
const dirent = (name, isDir = true) => ({ name, isDirectory: () => isDir });

test('listAccounts: только каталоги, без example/скрытых, отсортировано', async () => {
  const readdirFn = async () => [
    dirent('startsev'), dirent('belonogov'), dirent('example'),
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

test('GET /api/accounts → { accounts: [...] }', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/accounts`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(Array.isArray(json.accounts));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// --- isLoopbackRequest (защита управляющих эндпоинтов) ---
test('isLoopbackRequest: петлевой Host без Origin → true', () => {
  assert.equal(isLoopbackRequest({ headers: { host: '127.0.0.1:8787' } }), true);
  assert.equal(isLoopbackRequest({ headers: { host: 'localhost:8787' } }), true);
  assert.equal(isLoopbackRequest({ headers: { host: '[::1]:8787' } }), true);
});

test('isLoopbackRequest: не-петлевой Host → false', () => {
  assert.equal(isLoopbackRequest({ headers: { host: 'evil.com' } }), false);
  assert.equal(isLoopbackRequest({ headers: { host: '192.168.1.5:8787' } }), false);
  assert.equal(isLoopbackRequest({ headers: {} }), false);
});

test('isLoopbackRequest: cross-origin Origin → false, же-origin → true', () => {
  assert.equal(isLoopbackRequest({ headers: { host: '127.0.0.1:8787', origin: 'http://evil.com' } }), false);
  assert.equal(isLoopbackRequest({ headers: { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787' } }), true);
  assert.equal(isLoopbackRequest({ headers: { host: '127.0.0.1:8787', origin: 'http://localhost:9999' } }), true);
  // непарсимый Origin → отклоняем
  assert.equal(isLoopbackRequest({ headers: { host: '127.0.0.1:8787', origin: 'не-url' } }), false);
});

test('POST /api/start: cross-origin Origin → 403, runner не вызывается', async () => {
  const runner = { start: () => { throw new Error('не должно вызваться'); }, stop: () => ({}), list: () => [] };
  await withServer(runner, async (base) => {
    const res = await fetch(`${base}/api/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.com' },
      body: JSON.stringify({ task: 'apply', account: 'a', live: true }),
    });
    assert.equal(res.status, 403);
  });
});

test('GET /api/tasks: отдаёт снимок runner.list', async () => {
  const runner = { start: () => ({}), stop: () => ({}), list: () => [{ account: 'acc1', task: 'messages', pid: 9, live: false, startedAt: 1 }] };
  await withServer(runner, async (base) => {
    const res = await fetch(`${base}/api/tasks`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.tasks.length, 1);
    assert.equal(json.tasks[0].account, 'acc1');
  });
});
