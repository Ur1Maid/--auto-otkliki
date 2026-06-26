import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUsageCounter } from '../src/lib/usageCounter.js';

// --- createUsageCounter: начальное состояние ---

test('createUsageCounter: новый счётчик → snapshot нули, calls 0', () => {
  const c = createUsageCounter();
  assert.deepEqual(c.snapshot(), {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    apiErrors: 0,
    balanceExhausted: false,
  });
});

// --- record: валидный usage ---

test('record с валидным usage → корректные суммы', () => {
  const c = createUsageCounter();
  c.record({ prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 80 });
  assert.deepEqual(c.snapshot(), {
    calls: 1,
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    cacheHitTokens: 80,
    apiErrors: 0,
    balanceExhausted: false,
  });
});

test('несколько record → суммируются', () => {
  const c = createUsageCounter();
  c.record({ prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 50 });
  c.record({ prompt_tokens: 200, completion_tokens: 30, prompt_cache_hit_tokens: 10 });
  assert.deepEqual(c.snapshot(), {
    calls: 2,
    promptTokens: 300,
    completionTokens: 50,
    totalTokens: 350,
    cacheHitTokens: 60,
    apiErrors: 0,
    balanceExhausted: false,
  });
});

test('totalTokens = promptTokens + completionTokens', () => {
  const c = createUsageCounter();
  c.record({ prompt_tokens: 123, completion_tokens: 77, prompt_cache_hit_tokens: 0 });
  const s = c.snapshot();
  assert.equal(s.totalTokens, s.promptTokens + s.completionTokens);
  assert.equal(s.totalTokens, 200);
});

// --- record: невалидные входы не бросают, calls инкрементится ---

test('record(null) → не бросает, calls инкрементится, токены не растут', () => {
  const c = createUsageCounter();
  assert.doesNotThrow(() => c.record(null));
  assert.equal(c.snapshot().calls, 1);
  assert.equal(c.snapshot().promptTokens, 0);
});

test('record(undefined) → не бросает, calls инкрементится, токены не растут', () => {
  const c = createUsageCounter();
  assert.doesNotThrow(() => c.record(undefined));
  assert.equal(c.snapshot().calls, 1);
  assert.equal(c.snapshot().promptTokens, 0);
});

test('record(42) → не бросает, calls инкрементится, токены не растут', () => {
  const c = createUsageCounter();
  assert.doesNotThrow(() => c.record(42));
  assert.equal(c.snapshot().calls, 1);
  assert.equal(c.snapshot().promptTokens, 0);
});

test('record("строка") → не бросает, calls инкрементится, токены не растут', () => {
  const c = createUsageCounter();
  assert.doesNotThrow(() => c.record('строка'));
  assert.equal(c.snapshot().calls, 1);
  assert.equal(c.snapshot().completionTokens, 0);
});

// --- record: частичный usage ---

test('record с частичным usage (только prompt_tokens) → completion/cacheHit остаются 0', () => {
  const c = createUsageCounter();
  c.record({ prompt_tokens: 50 });
  const s = c.snapshot();
  assert.equal(s.promptTokens, 50);
  assert.equal(s.completionTokens, 0);
  assert.equal(s.cacheHitTokens, 0);
});

test('cacheHitTokens учитывается из prompt_cache_hit_tokens', () => {
  const c = createUsageCounter();
  c.record({ prompt_tokens: 200, completion_tokens: 10, prompt_cache_hit_tokens: 150 });
  assert.equal(c.snapshot().cacheHitTokens, 150);
});

// --- formatSummary ---

test('formatSummary возвращает непустую строку', () => {
  const c = createUsageCounter();
  c.record({ prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 80 });
  const s = c.formatSummary();
  assert.ok(typeof s === 'string' && s.length > 0, 'строка должна быть непустой');
});

test('formatSummary содержит число вызовов', () => {
  const c = createUsageCounter();
  c.record({ prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 0 });
  c.record({ prompt_tokens: 50, completion_tokens: 10, prompt_cache_hit_tokens: 0 });
  const s = c.formatSummary();
  assert.ok(s.includes('2'), `строка должна содержать количество вызовов (2): "${s}"`);
});

test('formatSummary содержит суммарное число токенов', () => {
  const c = createUsageCounter();
  c.record({ prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 0 });
  const s = c.formatSummary();
  assert.ok(s.includes('120'), `строка должна содержать totalTokens (120): "${s}"`);
});

// --- независимость инстансов ---

test('два createUsageCounter() не делят состояние', () => {
  const a = createUsageCounter();
  const b = createUsageCounter();
  a.record({ prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 0 });
  assert.equal(a.snapshot().calls, 1);
  assert.equal(b.snapshot().calls, 0);
  assert.equal(b.snapshot().promptTokens, 0);
});

// --- reset ---

test('reset обнуляет все счётчики', () => {
  const c = createUsageCounter();
  c.record({ prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 50 });
  c.recordError(402);
  c.reset();
  assert.deepEqual(c.snapshot(), {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    apiErrors: 0,
    balanceExhausted: false,
  });
});

// --- recordError (для алертинга) ---

test('recordError инкрементит apiErrors, не трогает calls/токены', () => {
  const c = createUsageCounter();
  c.recordError(500);
  c.recordError(429);
  const s = c.snapshot();
  assert.equal(s.apiErrors, 2);
  assert.equal(s.calls, 0);
  assert.equal(s.balanceExhausted, false);
});

test('recordError(402) выставляет липкий balanceExhausted', () => {
  const c = createUsageCounter();
  c.recordError(402);
  assert.equal(c.snapshot().balanceExhausted, true);
  c.recordError(500); // последующая не-402 не сбрасывает флаг
  assert.equal(c.snapshot().balanceExhausted, true);
  assert.equal(c.snapshot().apiErrors, 2);
});
