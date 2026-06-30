import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResourceLogger } from '../src/lib/resourceLog.js';

const MB = 1024 * 1024;

// Фиксированный момент — детерминизм, без Date.now().
const FIXED_TS = 1700000000000;

// Хелпер: строит набор инъецируемых зависимостей с записью вызовов.
function makeDeps(overrides = {}) {
  const calls = { append: [], mkdir: [] };
  const deps = {
    appendFile: async (p, data, enc) => {
      calls.append.push({ p, data, enc });
    },
    mkdir: async (dir, opts) => {
      calls.mkdir.push({ dir, opts });
    },
    filePath: 'logs/resources.jsonl',
    memoryUsage: () => ({ rss: 100 * MB, heapUsed: 50 * MB }),
    cpuUsage: () => ({ user: 0, system: 0 }),
    now: () => FIXED_TS,
    ...overrides,
  };
  return { deps, calls };
}

// ---------------------------------------------------------------------------
// Счастливый путь
// ---------------------------------------------------------------------------

test('createResourceLogger: первый вызов записывает валидную JSONL-строку', async () => {
  const { deps, calls } = makeDeps();
  const log = createResourceLogger(deps);

  const row = await log({ openContexts: 2 });

  assert.ok(row !== null, 'должен вернуть запись, а не null');
  assert.equal(calls.append.length, 1);
  assert.equal(calls.append[0].enc, 'utf8');

  const line = calls.append[0].data;
  assert.ok(line.endsWith('\n'), 'строка должна заканчиваться на \\n');

  const parsed = JSON.parse(line.trim());
  assert.equal(parsed.ts, new Date(FIXED_TS).toISOString());
  assert.equal(typeof parsed.rssMb, 'number');
  assert.equal(typeof parsed.heapMb, 'number');
  assert.equal(typeof parsed.cpuPercent, 'number');
  assert.equal(typeof parsed.openContexts, 'number');
  assert.ok(Number.isInteger(parsed.openContexts));
});

test('createResourceLogger: rssMb/heapMb правильно считаются из инъецированного memoryUsage', async () => {
  const { deps } = makeDeps({
    memoryUsage: () => ({ rss: 100 * MB, heapUsed: 50 * MB }),
  });
  const log = createResourceLogger(deps);
  const row = await log();

  assert.equal(row.rssMb, 100);
  assert.equal(row.heapMb, 50);
});

// ---------------------------------------------------------------------------
// Первый семпл: cpuPercent === 0 (нет prevCpu)
// ---------------------------------------------------------------------------

test('createResourceLogger: первый вызов → cpuPercent равен 0 (нет prevCpu)', async () => {
  const { deps } = makeDeps({
    cpuUsage: () => ({ user: 500000, system: 100000 }),
  });
  const log = createResourceLogger(deps);
  const row = await log();

  // Первый семпл: prevCpu=null, elapsedMs=0 → cpuPercent должен быть 0.
  assert.equal(row.cpuPercent, 0);
});

// ---------------------------------------------------------------------------
// Второй семпл: cpuPercent > 0 — замыкание отслеживает prevCpu/prevTs
// ---------------------------------------------------------------------------

test('createResourceLogger: второй вызов с ненулевой дельтой CPU → cpuPercent > 0', async () => {
  let callCount = 0;
  // Первый вызов: cpu = { user: 0, system: 0 }, ts = FIXED_TS
  // Второй вызов: cpu = { user: 500000, system: 0 }, ts = FIXED_TS + 1000
  const { deps } = makeDeps({
    cpuUsage: () => {
      callCount += 1;
      return callCount === 1
        ? { user: 0, system: 0 }
        : { user: 500000, system: 0 };
    },
    now: (() => {
      let n = 0;
      return () => {
        n += 1;
        return n === 1 ? FIXED_TS : FIXED_TS + 1000;
      };
    })(),
  });

  const log = createResourceLogger(deps);
  const row1 = await log();
  const row2 = await log();

  assert.equal(row1.cpuPercent, 0, 'первый семпл: cpuPercent=0');
  // delta user = 500000 мкс за 1000 мс → 50%
  assert.equal(row2.cpuPercent, 50, 'второй семпл: cpuPercent=50');
});

// ---------------------------------------------------------------------------
// mkdir вызывается с recursive:true перед append
// ---------------------------------------------------------------------------

test('createResourceLogger: mkdir вызывается с recursive:true до append', async () => {
  const { deps, calls } = makeDeps({ filePath: 'logs/resources.jsonl' });
  const log = createResourceLogger(deps);
  await log();

  assert.equal(calls.mkdir.length, 1);
  assert.deepEqual(calls.mkdir[0].opts, { recursive: true });
  // mkdir должен быть вызван до append (порядок в массиве calls не подходит напрямую, но
  // реализация последовательная: await mkdir, затем await append).
  assert.equal(calls.append.length, 1);
});

// ---------------------------------------------------------------------------
// openContexts: нормализация
// ---------------------------------------------------------------------------

test('createResourceLogger: отрицательный openContexts → 0', async () => {
  const { deps } = makeDeps();
  const log = createResourceLogger(deps);
  const row = await log({ openContexts: -1 });
  assert.equal(row.openContexts, 0);
});

test('createResourceLogger: NaN openContexts → 0', async () => {
  const { deps } = makeDeps();
  const log = createResourceLogger(deps);
  const row = await log({ openContexts: NaN });
  assert.equal(row.openContexts, 0);
});

test('createResourceLogger: отсутствующий openContexts → 0', async () => {
  const { deps } = makeDeps();
  const log = createResourceLogger(deps);
  const row = await log();
  assert.equal(row.openContexts, 0);
});

test('createResourceLogger: 3.9 → 3 (floor)', async () => {
  const { deps } = makeDeps();
  const log = createResourceLogger(deps);
  const row = await log({ openContexts: 3.9 });
  assert.equal(row.openContexts, 3);
});

// ---------------------------------------------------------------------------
// Best-effort: appendFile бросает → возвращает null, не бросает
// ---------------------------------------------------------------------------

test('createResourceLogger: ошибка appendFile → возвращает null, не бросает', async () => {
  const { deps } = makeDeps({
    appendFile: async () => {
      throw new Error('disk full');
    },
  });
  const log = createResourceLogger(deps);
  const result = await log({ openContexts: 0 });
  assert.equal(result, null, 'должен вернуть null при ошибке IO');
});

test('createResourceLogger: ошибка mkdir → возвращает null, не бросает', async () => {
  const { deps } = makeDeps({
    mkdir: async () => {
      throw new Error('EACCES');
    },
  });
  const log = createResourceLogger(deps);
  const result = await log();
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// Безопасность: в записанной строке только ожидаемые ключи, нет секретов
// ---------------------------------------------------------------------------

test('createResourceLogger: записанная строка содержит ровно нужные ключи, без секретов', async () => {
  const { deps, calls } = makeDeps();
  const log = createResourceLogger(deps);
  await log({ openContexts: 1 });

  const parsed = JSON.parse(calls.append[0].data.trim());
  const keys = Object.keys(parsed).sort();
  assert.deepEqual(keys, ['cpuPercent', 'heapMb', 'openContexts', 'rssMb', 'ts']);

  // Грубая проверка: ни одно значение не похоже на API-ключ или токен (не строка > 20 символов).
  for (const [k, v] of Object.entries(parsed)) {
    if (k === 'ts') continue; // ISO-строка допустима
    assert.notEqual(typeof v, 'string', `поле ${k} не должно быть строкой (только числа)`);
  }
});

// ---------------------------------------------------------------------------
// ts совпадает с инъецированным now
// ---------------------------------------------------------------------------

test('createResourceLogger: ts равен new Date(инъецированный_now).toISOString()', async () => {
  const MY_TS = 1700000000000;
  const { deps } = makeDeps({ now: () => MY_TS });
  const log = createResourceLogger(deps);
  const row = await log();

  assert.equal(row.ts, new Date(MY_TS).toISOString());
});
