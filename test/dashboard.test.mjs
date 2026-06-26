import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePort, collectMetrics, createServer } from '../src/dashboard.js';

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
