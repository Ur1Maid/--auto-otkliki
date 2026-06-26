import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseJsonl,
  aggregateResponses,
  aggregateSummaries,
  aggregateDaily,
  estimateCost,
  computeFunnel,
  APPLIED_STATUS,
} from '../src/lib/metrics.js';

// --- parseJsonl ---
test('parseJsonl: валидные строки → объекты, битые пропускаются', () => {
  const text = '{"a":1}\nне-json\n{"b":2}\n';
  assert.deepEqual(parseJsonl(text), [{ a: 1 }, { b: 2 }]);
});

test('parseJsonl: не-строка / пусто → []', () => {
  assert.deepEqual(parseJsonl(null), []);
  assert.deepEqual(parseJsonl(''), []);
  assert.deepEqual(parseJsonl('   '), []);
});

// --- aggregateResponses ---
test('aggregateResponses: считает applied, byStatus, byAccount, daily', () => {
  const entries = [
    { status: APPLIED_STATUS, account: 'a', at: '2026-06-26T10:00:00Z' },
    { status: APPLIED_STATUS, account: 'a', at: '2026-06-26T11:00:00Z' },
    { status: 'error', account: 'b', at: '2026-06-26T12:00:00Z' },
    { status: 'skipped', account: 'a', at: '2026-06-25T09:00:00Z' },
  ];
  const r = aggregateResponses(entries);
  assert.equal(r.total, 4);
  assert.equal(r.applied, 2);
  assert.equal(r.byStatus[APPLIED_STATUS], 2);
  assert.equal(r.byStatus.error, 1);
  assert.equal(r.byAccount.a.applied, 2);
  assert.equal(r.byAccount.b.errors, 1);
  assert.equal(r.daily.length, 2);
  assert.equal(r.daily[0].day, '2026-06-25'); // отсортировано по дате
  assert.equal(r.daily[1].applied, 2);
});

test('aggregateResponses: не-массив / мусорные элементы → не падает', () => {
  const r = aggregateResponses([null, 'x', { status: APPLIED_STATUS }]);
  assert.equal(r.applied, 1);
  assert.equal(r.byAccount.default.applied, 1); // нет account → default
});

// --- aggregateSummaries ---
test('aggregateSummaries: суммирует токены и скоринг, считает cacheHitRatio', () => {
  const s = aggregateSummaries([
    { account: 'a', applied: 5, locallyScored: 10, modelScored: 5, cachedScored: 5, tokensRunCumulative: 1000 },
    { account: 'b', applied: 3, locallyScored: 0, modelScored: 0, cachedScored: 0, tokensRunCumulative: 500 },
  ]);
  assert.equal(s.totals.applied, 8);
  assert.equal(s.totals.tokens, 1500);
  assert.equal(s.totals.cachedScored, 5);
  assert.equal(s.cacheHitRatio, 5 / 20); // 5 cached из 20 scored
  assert.equal(s.accounts.length, 2);
});

test('aggregateSummaries: объектный tokensRunCumulative → разбивка + context-cache ratio', () => {
  const s = aggregateSummaries([
    {
      account: 'a', applied: 5,
      tokensRunCumulative: { calls: 3, promptTokens: 1000, completionTokens: 400, totalTokens: 1400, cacheHitTokens: 600 },
    },
    {
      account: 'b', applied: 2,
      tokensRunCumulative: { calls: 1, promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0 },
    },
  ]);
  assert.equal(s.totals.promptTokens, 1000);
  assert.equal(s.totals.completionTokens, 400);
  assert.equal(s.totals.cacheHitTokens, 600);
  assert.equal(s.totals.tokens, 1400); // totalTokens
  assert.equal(s.tokenCacheHitRatio, 600 / 1000); // реальный context-cache hit
});

test('aggregateSummaries: totalTokens отсутствует → берём prompt+completion', () => {
  const s = aggregateSummaries([
    { account: 'a', tokensRunCumulative: { promptTokens: 200, completionTokens: 100, cacheHitTokens: 50 } },
  ]);
  assert.equal(s.totals.tokens, 300);
});

test('aggregateSummaries: пусто → нулевые тоталы, ratio 0 (не делит на ноль)', () => {
  const s = aggregateSummaries([]);
  assert.equal(s.totals.tokens, 0);
  assert.equal(s.totals.promptTokens, 0);
  assert.equal(s.cacheHitRatio, 0);
  assert.equal(s.tokenCacheHitRatio, 0);
});

// --- aggregateDaily ---
test('aggregateDaily: разворачивает вложенные счётчики, сортирует по дате', () => {
  const d = aggregateDaily([
    { date: '2026-06-26', applications: { applied: 5 }, messages: { processed: 3, replied: 1 }, resume: { editsApplied: 2 }, tokens: { promptTokens: 100, completionTokens: 50 } },
    { date: '2026-06-25', applications: { applied: 2 } },
  ]);
  assert.equal(d[0].date, '2026-06-25');
  assert.equal(d[1].applied, 5);
  assert.equal(d[1].messagesProcessed, 3);
  assert.equal(d[1].tokens, 150);
});

// --- estimateCost ---
test('estimateCost: вход cache-miss/hit + выход', () => {
  // 1M miss * 0.27 + 0 hit + 1M out * 1.10 = 1.37
  const c = estimateCost({ promptTokens: 1e6, completionTokens: 1e6, cacheHitTokens: 0 });
  assert.ok(Math.abs(c - 1.37) < 1e-9, `got ${c}`);
});

test('estimateCost: cache-hit удешевляет вход', () => {
  // prompt 1M, hit 1M → весь вход по hit-цене 0.07; выход 0
  const c = estimateCost({ promptTokens: 1e6, completionTokens: 0, cacheHitTokens: 1e6 });
  assert.ok(Math.abs(c - 0.07) < 1e-9, `got ${c}`);
});

test('estimateCost: пустые токены → 0', () => {
  assert.equal(estimateCost({}), 0);
});

// --- computeFunnel ---
test('computeFunnel: конверсия и reply-rate', () => {
  const f = computeFunnel({ applied: 100, messagesProcessed: 20, replied: 10 });
  assert.equal(f.stages.length, 3);
  assert.equal(f.conversionPct, 20);
  assert.equal(f.replyRatePct, 50);
});

test('computeFunnel: ноль откликов → конверсия 0 (не делит на ноль)', () => {
  const f = computeFunnel({ applied: 0, messagesProcessed: 0, replied: 0 });
  assert.equal(f.conversionPct, 0);
  assert.equal(f.replyRatePct, 0);
});
