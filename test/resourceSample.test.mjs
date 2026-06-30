import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleProcessResources, formatResources } from '../src/lib/resourceSample.js';

const MB = 1024 * 1024;

// --- sampleProcessResources: память ---

test('sampleProcessResources: rss/heap байты → МБ с округлением 0.1', () => {
  const s = sampleProcessResources({
    memoryUsage: { rss: 123 * MB, heapUsed: 45.6 * MB },
  });
  assert.equal(s.rssMb, 123);
  assert.equal(s.heapMb, 45.6);
});

test('sampleProcessResources: дробные байты округляются до 0.1 МБ', () => {
  const s = sampleProcessResources({
    memoryUsage: { rss: Math.round(10.04 * MB), heapUsed: Math.round(10.06 * MB) },
  });
  assert.equal(s.rssMb, 10);
  assert.equal(s.heapMb, 10.1);
});

test('sampleProcessResources: отсутствующая/мусорная память → 0', () => {
  assert.deepEqual(sampleProcessResources({ memoryUsage: {} }), {
    rssMb: 0,
    heapMb: 0,
    cpuPercent: 0,
  });
  assert.equal(sampleProcessResources({ memoryUsage: { rss: -5, heapUsed: 'x' } }).rssMb, 0);
  assert.equal(sampleProcessResources({ memoryUsage: { rss: NaN } }).rssMb, 0);
  assert.equal(sampleProcessResources({ memoryUsage: null }).rssMb, 0);
});

// --- sampleProcessResources: CPU ---

test('sampleProcessResources: cpuPercent из дельты cpuUsage и elapsedMs', () => {
  // delta user+system = 500000 мкс busy за 1000 мс настенного времени → 50%
  const s = sampleProcessResources({
    cpuUsage: { user: 700000, system: 300000 },
    prevCpu: { user: 500000, system: 0 },
    elapsedMs: 1000,
  });
  assert.equal(s.cpuPercent, 50);
});

test('sampleProcessResources: >100% на многоядерной нагрузке не клампится', () => {
  // 1.5 c CPU за 1 c настенного → 150%
  const s = sampleProcessResources({
    cpuUsage: { user: 1500000, system: 0 },
    prevCpu: { user: 0, system: 0 },
    elapsedMs: 1000,
  });
  assert.equal(s.cpuPercent, 150);
});

test('sampleProcessResources: нет prevCpu/cpuUsage или elapsedMs<=0 → cpuPercent 0', () => {
  assert.equal(
    sampleProcessResources({ cpuUsage: { user: 1, system: 1 }, elapsedMs: 1000 }).cpuPercent,
    0,
  );
  assert.equal(
    sampleProcessResources({ prevCpu: { user: 0, system: 0 }, elapsedMs: 1000 }).cpuPercent,
    0,
  );
  assert.equal(
    sampleProcessResources({
      cpuUsage: { user: 1, system: 1 },
      prevCpu: { user: 0, system: 0 },
      elapsedMs: 0,
    }).cpuPercent,
    0,
  );
  assert.equal(
    sampleProcessResources({
      cpuUsage: { user: 1, system: 1 },
      prevCpu: { user: 0, system: 0 },
      elapsedMs: -10,
    }).cpuPercent,
    0,
  );
});

test('sampleProcessResources: убывающая/нулевая дельта CPU → 0 (не отрицательный)', () => {
  const s = sampleProcessResources({
    cpuUsage: { user: 100, system: 100 },
    prevCpu: { user: 500, system: 500 },
    elapsedMs: 1000,
  });
  assert.equal(s.cpuPercent, 0);
});

// --- sampleProcessResources: guard ---

test('sampleProcessResources: не-объект/пусто → все нули, не бросает', () => {
  const zero = { rssMb: 0, heapMb: 0, cpuPercent: 0 };
  assert.deepEqual(sampleProcessResources(), zero);
  assert.deepEqual(sampleProcessResources(null), zero);
  assert.deepEqual(sampleProcessResources('строка'), zero);
  assert.deepEqual(sampleProcessResources(123), zero);
});

// --- formatResources ---

test('formatResources: строит русскую строку из среза', () => {
  assert.equal(
    formatResources({ rssMb: 123.4, heapMb: 45.6, cpuPercent: 12.3 }),
    'RSS 123.4 МБ, heap 45.6 МБ, CPU 12.3%',
  );
});

test('formatResources: мусор/отсутствие полей → нули, не бросает', () => {
  assert.equal(formatResources(), 'RSS 0 МБ, heap 0 МБ, CPU 0%');
  assert.equal(formatResources(null), 'RSS 0 МБ, heap 0 МБ, CPU 0%');
  assert.equal(
    formatResources({ rssMb: -1, heapMb: 'x', cpuPercent: NaN }),
    'RSS 0 МБ, heap 0 МБ, CPU 0%',
  );
});

test('formatResources: round-trip с sampleProcessResources', () => {
  const s = sampleProcessResources({
    memoryUsage: { rss: 50 * MB, heapUsed: 20 * MB },
    cpuUsage: { user: 250000, system: 0 },
    prevCpu: { user: 0, system: 0 },
    elapsedMs: 1000,
  });
  assert.equal(formatResources(s), 'RSS 50 МБ, heap 20 МБ, CPU 25%');
});
