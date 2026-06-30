import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTaskRunner } from '../src/lib/taskRunner.js';

// --- Фейковый дочерний процесс (без реального process) ---
function makeFakeChild(pid = 4242) {
  const handlers = {};
  return {
    pid,
    killed: false,
    killSignal: null,
    on(event, cb) {
      (handlers[event] || (handlers[event] = [])).push(cb);
      return this;
    },
    kill(signal) {
      this.killed = true;
      this.killSignal = signal;
      return true;
    },
    emit(event, ...args) {
      for (const cb of handlers[event] || []) cb(...args);
    },
  };
}

/** Фабрика runner с фейковым spawn, фиксированным временем и захватом spawn-вызовов. */
function makeRunner(overrides = {}) {
  const spawnCalls = [];
  const children = [];
  const spawn = overrides.spawn || ((execPath, args, opts) => {
    const child = makeFakeChild(overrides.pid ?? (5000 + children.length));
    spawnCalls.push({ execPath, args, opts });
    children.push(child);
    return child;
  });
  const runner = createTaskRunner({
    spawn,
    execPath: 'node-stub',
    daemonPath: '/repo/src/daemon.js',
    now: () => 1000,
    ...overrides.deps,
  });
  return { runner, spawnCalls, children };
}

// --- start: успешный запуск (dry-run по умолчанию) ---
test('start: dry-run по умолчанию — без --live, трекает pid', () => {
  const { runner, spawnCalls } = makeRunner();
  const r = runner.start({ task: 'messages', account: 'acc1' });

  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.account, 'acc1');
  assert.equal(r.task, 'messages');
  assert.equal(r.live, false);
  assert.equal(typeof r.pid, 'number');

  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].execPath, 'node-stub');
  assert.deepEqual(spawnCalls[0].args, [
    '/repo/src/daemon.js', '--task', 'messages', '--account', 'acc1',
  ]);
  // Без shell — массив аргументов.
  assert.equal(spawnCalls[0].opts.shell, undefined);
});

// --- start: live только по явному флагу ---
test('start: live === true добавляет --live', () => {
  const { runner, spawnCalls } = makeRunner();
  const r = runner.start({ task: 'apply', account: 'acc1', live: true });
  assert.equal(r.ok, true);
  assert.equal(r.live, true);
  assert.ok(spawnCalls[0].args.includes('--live'));
});

test('start: live !== true (truthy не-true) НЕ добавляет --live', () => {
  const { runner, spawnCalls } = makeRunner();
  const r = runner.start({ task: 'apply', account: 'acc1', live: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.live, false);
  assert.ok(!spawnCalls[0].args.includes('--live'));
});

// --- start: apply-поля прокидываются ---
test('start: apply пробрасывает limit/text/area', () => {
  const { runner, spawnCalls } = makeRunner();
  runner.start({ task: 'apply', account: 'acc1', limit: 50, text: 'DevOps', area: 1 });
  const args = spawnCalls[0].args;
  assert.ok(args.includes('--text') && args.includes('DevOps'));
  assert.ok(args.includes('--area') && args.includes('1'));
  assert.ok(args.includes('--limit') && args.includes('50'));
});

// --- start: дубль на аккаунт → 409 ---
test('start: повторный старт на занятый аккаунт → 409', () => {
  const { runner, spawnCalls } = makeRunner();
  const r1 = runner.start({ task: 'messages', account: 'acc1' });
  assert.equal(r1.ok, true);
  const r2 = runner.start({ task: 'resume', account: 'acc1' });
  assert.equal(r2.ok, false);
  assert.equal(r2.status, 409);
  // Второй спавн не произошёл.
  assert.equal(spawnCalls.length, 1);
});

test('start: разные аккаунты не блокируют друг друга', () => {
  const { runner, spawnCalls } = makeRunner();
  assert.equal(runner.start({ task: 'messages', account: 'acc1' }).ok, true);
  assert.equal(runner.start({ task: 'messages', account: 'acc2' }).ok, true);
  assert.equal(spawnCalls.length, 2);
});

// --- start: невалидный ввод → 400 (без спавна) ---
test('start: невалидный task → 400, спавна нет', () => {
  const { runner, spawnCalls } = makeRunner();
  const r = runner.start({ task: 'nope', account: 'acc1' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(spawnCalls.length, 0);
});

test('start: пустой account → 400, спавна нет', () => {
  const { runner, spawnCalls } = makeRunner();
  const r = runner.start({ task: 'apply', account: '   ' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(spawnCalls.length, 0);
});

// --- start: сбой spawn → 500 ---
test('start: spawn бросает → 500, аккаунт не занят', () => {
  const { runner } = makeRunner({
    spawn: () => { throw new Error('spawn failed'); },
  });
  const r = runner.start({ task: 'messages', account: 'acc1' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 500);
  // Аккаунт свободен — можно пробовать снова.
  assert.equal(runner.list().length, 0);
});

// --- list: снимок без child ---
test('list: возвращает account/task/pid/live/startedAt без child', () => {
  const { runner } = makeRunner();
  runner.start({ task: 'apply', account: 'acc1', live: true });
  const list = runner.list();
  assert.equal(list.length, 1);
  assert.deepEqual(Object.keys(list[0]).sort(), ['account', 'live', 'pid', 'startedAt', 'task']);
  assert.equal(list[0].startedAt, 1000);
  assert.equal(list[0].account, 'acc1');
});

// --- exit освобождает аккаунт ---
test('exit/close дочернего процесса освобождает аккаунт', () => {
  const { runner, children } = makeRunner();
  runner.start({ task: 'messages', account: 'acc1' });
  assert.equal(runner.list().length, 1);
  children[0].emit('exit', 0);
  assert.equal(runner.list().length, 0);
  // После выхода аккаунт снова можно занять.
  assert.equal(runner.start({ task: 'resume', account: 'acc1' }).ok, true);
});

// --- stop: kill трекаемого процесса ---
test('stop: killит процесс и освобождает аккаунт', () => {
  const { runner, children } = makeRunner();
  runner.start({ task: 'messages', account: 'acc1' });
  const r = runner.stop({ account: 'acc1' });
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.task, 'messages');
  assert.equal(children[0].killed, true);
  assert.equal(runner.list().length, 0);
});

test('stop: нет задачи для аккаунта → 404', () => {
  const { runner } = makeRunner();
  const r = runner.stop({ account: 'ghost' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
});

test('stop: пустой account → 400', () => {
  const { runner } = makeRunner();
  const r = runner.stop({ account: '' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('stop: kill бросает — не падает, аккаунт освобождён', () => {
  const { runner, children } = makeRunner();
  runner.start({ task: 'messages', account: 'acc1' });
  children[0].kill = () => { throw new Error('already dead'); };
  const r = runner.stop({ account: 'acc1' });
  assert.equal(r.ok, true);
  assert.equal(runner.list().length, 0);
});

// --- лог не содержит секретов (получает только task/account/pid/live) ---
test('start/stop: лог получает только task/account, без секретов/PII', () => {
  const logs = [];
  const { runner } = makeRunner({ deps: { log: (m) => logs.push(m) } });
  runner.start({ task: 'apply', account: 'acc1', live: true, text: 'секретный-поиск' });
  runner.stop({ account: 'acc1' });
  assert.ok(logs.length >= 2);
  // В логах нет текста поиска/писем — только идентификаторы задачи.
  for (const line of logs) {
    assert.ok(!line.includes('секретный-поиск'));
  }
});

// --- M11.9: live-запуск даёт аудит-строку «LIVE запущен оператором», dry-run — нет ---
test('start: live даёт аудит-строку «LIVE запущен оператором: <task>/<account>»', () => {
  const logs = [];
  const { runner } = makeRunner({ deps: { log: (m) => logs.push(m) } });
  runner.start({ task: 'apply', account: 'acc1', live: true });
  const audit = logs.find((l) => l.includes('LIVE запущен оператором'));
  assert.ok(audit, 'нет аудит-строки live-запуска');
  assert.ok(audit.includes('apply/acc1'));
});

test('start: dry-run НЕ помечается как LIVE в аудит-логе', () => {
  const logs = [];
  const { runner } = makeRunner({ deps: { log: (m) => logs.push(m) } });
  runner.start({ task: 'apply', account: 'acc1' });
  assert.ok(!logs.some((l) => l.includes('LIVE запущен оператором')));
  assert.ok(logs.some((l) => l.includes('dry-run запущен')));
});
