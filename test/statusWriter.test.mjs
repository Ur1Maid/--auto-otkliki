import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeHeartbeatFile } from '../src/lib/statusWriter.js';

// Фиксированный момент — детерминизм, без Date.now().
const TS = new Date('2026-06-30T12:00:00.000Z');

// Хелпер: моки IO с записью вызовов.
function makeDeps(overrides = {}) {
  const calls = { write: [], mkdir: [] };
  const deps = {
    writeFile: async (p, data, enc) => {
      calls.write.push({ p, data, enc });
    },
    mkdir: async (dir, opts) => {
      calls.mkdir.push({ dir, opts });
    },
    getStatusPath: (account, task) => `logs/status/${account}${task ? '__' + task : ''}.json`,
    ...overrides,
  };
  return { deps, calls };
}

test('writeHeartbeatFile: пишет нормализованный хартбит в путь аккаунта', async () => {
  const { deps, calls } = makeDeps();
  const hb = await writeHeartbeatFile(
    'acc1',
    { task: 'apply', phase: 'review', index: 12, total: 200, lastEvent: 'scored', state: 'ok', ts: TS },
    deps,
  );

  assert.equal(calls.write.length, 1);
  assert.equal(calls.write[0].p, 'logs/status/acc1__apply.json');
  assert.equal(calls.write[0].enc, 'utf8');

  const written = JSON.parse(calls.write[0].data);
  assert.deepEqual(written, {
    task: 'apply',
    account: 'acc1',
    phase: 'review',
    index: 12,
    total: 200,
    lastEvent: 'scored',
    state: 'ok',
    ts: '2026-06-30T12:00:00.000Z',
  });
  assert.deepEqual(hb, written);
});

test('writeHeartbeatFile: создаёт каталог статуса (mkdir recursive) перед записью', async () => {
  const { deps, calls } = makeDeps();
  await writeHeartbeatFile('acc1', { task: 'messages', ts: TS }, deps);

  assert.equal(calls.mkdir.length, 1);
  assert.equal(calls.mkdir[0].dir, 'logs/status');
  assert.deepEqual(calls.mkdir[0].opts, { recursive: true });
});

test('writeHeartbeatFile: account из аргумента перекрывает fields.account', async () => {
  const { deps, calls } = makeDeps();
  await writeHeartbeatFile('real', { account: 'spoofed', task: 'resume', ts: TS }, deps);

  assert.equal(calls.write[0].p, 'logs/status/real__resume.json');
  const written = JSON.parse(calls.write[0].data);
  assert.equal(written.account, 'real');
});

test('writeHeartbeatFile: ошибка writeFile проглатывается, возвращает null', async () => {
  const { deps } = makeDeps({
    writeFile: async () => {
      throw new Error('disk full');
    },
  });
  const result = await writeHeartbeatFile('acc1', { task: 'apply', ts: TS }, deps);
  assert.equal(result, null);
});

test('writeHeartbeatFile: ошибка mkdir проглатывается, возвращает null', async () => {
  const { deps } = makeDeps({
    mkdir: async () => {
      throw new Error('EACCES');
    },
  });
  const result = await writeHeartbeatFile('acc1', { task: 'apply', ts: TS }, deps);
  assert.equal(result, null);
});

// --- M12.6: per-task пути без инъекции getStatusPath ---

// Хелпер без getStatusPath — проверяем реальный путь из getAccountTaskStatusPath.
function makeDepsNoPath(overrides = {}) {
  const calls = { write: [], mkdir: [] };
  const deps = {
    writeFile: async (p) => { calls.write.push(p); },
    mkdir: async () => {},
    ...overrides,
  };
  return { deps, calls };
}

test('writeHeartbeatFile: без getStatusPath — apply → путь содержит __apply.json (M12.6)', async () => {
  const { deps, calls } = makeDepsNoPath();
  await writeHeartbeatFile('belonogov', { task: 'apply', ts: TS }, deps);
  assert.equal(calls.write.length, 1);
  assert.ok(calls.write[0].endsWith('__apply.json'), `ожидался суффикс __apply.json, получено: ${calls.write[0]}`);
  assert.ok(calls.write[0].includes('belonogov'));
});

test('writeHeartbeatFile: без getStatusPath — messages → путь содержит __messages.json (M12.6)', async () => {
  const { deps, calls } = makeDepsNoPath();
  await writeHeartbeatFile('acc2', { task: 'messages', ts: TS }, deps);
  assert.ok(calls.write[0].endsWith('__messages.json'));
});

test('writeHeartbeatFile: без getStatusPath — resume → путь содержит __resume.json (M12.6)', async () => {
  const { deps, calls } = makeDepsNoPath();
  await writeHeartbeatFile('acc3', { task: 'resume', ts: TS }, deps);
  assert.ok(calls.write[0].endsWith('__resume.json'));
});

test('writeHeartbeatFile: apply и messages дают РАЗНЫЕ пути (M12.6 — не перетирают друг друга)', async () => {
  const pathsA = [], pathsM = [];
  const depsA = { writeFile: async (p) => pathsA.push(p), mkdir: async () => {} };
  const depsM = { writeFile: async (p) => pathsM.push(p), mkdir: async () => {} };
  await writeHeartbeatFile('acc1', { task: 'apply', ts: TS }, depsA);
  await writeHeartbeatFile('acc1', { task: 'messages', ts: TS }, depsM);
  assert.notEqual(pathsA[0], pathsM[0], 'пути apply и messages должны быть разными');
});
