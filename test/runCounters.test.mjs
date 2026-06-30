import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunCounters } from '../src/lib/runCounters.js';
import { createRunSummary } from '../src/lib/runSummary.js';

// ─── Хелпер: ожидаемая «нулевая» форма ────────────────────────────────────────

function zeroShape() {
  return {
    viewed: 0,
    sent: 0,
    skipped: 0,
    manual: 0,
    alreadyApplied: 0,
    errors: 0,
    tokens: {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheHitTokens: 0,
      estimatedCostUsd: 0,
    },
  };
}

// ─── 1. Happy path ────────────────────────────────────────────────────────────

test('buildRunCounters: полный summary + полные tokens → корректное отображение', () => {
  const summary = {
    viewed: 10,
    applied: 3,
    dryRun: 2,
    skipped: 4,
    manual: 1,
    alreadyApplied: 0,
    errors: 1,
    quit: 0,
  };
  const tokens = {
    calls: 7,
    promptTokens: 1000,
    completionTokens: 200,
    totalTokens: 9999, // намеренно неправильный — должен быть проигнорирован
    cacheHitTokens: 50,
    estimatedCostUsd: 0.005,
  };
  const r = buildRunCounters({ summary, tokens });
  assert.equal(r.viewed, 10);
  assert.equal(r.sent, 5);           // applied(3) + dryRun(2)
  assert.equal(r.skipped, 4);
  assert.equal(r.manual, 1);
  assert.equal(r.alreadyApplied, 0);
  assert.equal(r.errors, 1);
  assert.equal(r.tokens.calls, 7);
  assert.equal(r.tokens.promptTokens, 1000);
  assert.equal(r.tokens.completionTokens, 200);
  assert.equal(r.tokens.totalTokens, 1200);  // пересчитано, не 9999
  assert.equal(r.tokens.cacheHitTokens, 50);
  assert.equal(r.tokens.estimatedCostUsd, 0.005);
});

// ─── 2. Dry-run: applied=0, dryRun=5 → sent=5 ────────────────────────────────

test('buildRunCounters: dry-run прогон — sent = dryRun когда applied=0', () => {
  const summary = {
    viewed: 5,
    applied: 0,
    dryRun: 5,
    skipped: 0,
    manual: 0,
    alreadyApplied: 0,
    errors: 0,
    quit: 0,
  };
  const r = buildRunCounters({ summary, tokens: {} });
  assert.equal(r.sent, 5);
  assert.equal(r.viewed, 5);
});

// ─── 3. Обнуление на новом запуске ───────────────────────────────────────────

test('buildRunCounters: пустой summary {} → все счётчики 0 (новый прогон)', () => {
  const r = buildRunCounters({ summary: {}, tokens: {} });
  assert.deepEqual(r, zeroShape());
});

test('buildRunCounters: createRunSummary().snapshot() → все счётчики 0 (новый прогон)', () => {
  // Демонстрирует «обнуляются на новый запуск»: свежий инстанс runSummary даёт нули
  const fresh = createRunSummary().snapshot();
  const r = buildRunCounters({ summary: fresh, tokens: {} });
  assert.deepEqual(r, zeroShape());
});

// ─── 4. Guard-случаи: никогда не бросает, всегда корректная форма ─────────────

test('buildRunCounters() без аргументов → не бросает, нули', () => {
  let r;
  assert.doesNotThrow(() => { r = buildRunCounters(); });
  assert.deepEqual(r, zeroShape());
});

test('buildRunCounters({}) → не бросает, нули', () => {
  let r;
  assert.doesNotThrow(() => { r = buildRunCounters({}); });
  assert.deepEqual(r, zeroShape());
});

test('buildRunCounters({ summary: null, tokens: null }) → не бросает, нули', () => {
  let r;
  assert.doesNotThrow(() => { r = buildRunCounters({ summary: null, tokens: null }); });
  assert.deepEqual(r, zeroShape());
});

test('buildRunCounters({ summary: "x", tokens: 42 }) → не бросает, нули', () => {
  let r;
  assert.doesNotThrow(() => { r = buildRunCounters({ summary: 'x', tokens: 42 }); });
  assert.deepEqual(r, zeroShape());
});

test('buildRunCounters: summary — массив → не бросает, нули', () => {
  let r;
  assert.doesNotThrow(() => { r = buildRunCounters({ summary: [1, 2, 3], tokens: null }); });
  assert.deepEqual(r, zeroShape());
});

test('buildRunCounters: tokens — массив → не бросает, нули по токенам', () => {
  const summary = { viewed: 2, applied: 1, dryRun: 0, skipped: 1, manual: 0, alreadyApplied: 0, errors: 0 };
  let r;
  assert.doesNotThrow(() => { r = buildRunCounters({ summary, tokens: [1, 2] }); });
  assert.equal(r.viewed, 2);
  assert.equal(r.tokens.calls, 0);
  assert.equal(r.tokens.totalTokens, 0);
});

// ─── 5. Частичные входы ────────────────────────────────────────────────────────

test('buildRunCounters: summary с частичными полями → недостающие поля = 0', () => {
  // Только applied указан; остальные поля отсутствуют
  const r = buildRunCounters({ summary: { applied: 7 }, tokens: {} });
  assert.equal(r.sent, 7);   // applied=7, dryRun отсутствует → 0
  assert.equal(r.viewed, 0);
  assert.equal(r.skipped, 0);
  assert.equal(r.errors, 0);
});

test('buildRunCounters: tokens без estimatedCostUsd → estimatedCostUsd 0', () => {
  const tokens = { calls: 3, promptTokens: 100, completionTokens: 50, cacheHitTokens: 10 };
  const r = buildRunCounters({ summary: {}, tokens });
  assert.equal(r.tokens.estimatedCostUsd, 0);
  assert.equal(r.tokens.totalTokens, 150);
});

// ─── 6. Некорректные числа: NaN / Infinity / строки → 0 (нет утечки NaN) ───────

test('buildRunCounters: NaN в полях summary → 0, нет NaN в выводе', () => {
  const summary = { viewed: NaN, applied: NaN, dryRun: NaN, skipped: NaN, errors: NaN };
  const r = buildRunCounters({ summary, tokens: {} });
  assert.equal(r.viewed, 0);
  assert.equal(r.sent, 0);
  assert.equal(r.skipped, 0);
  assert.equal(r.errors, 0);
  // Проверяем, что нет NaN ни в одном числовом поле
  assert.ok(!isNaN(r.viewed));
  assert.ok(!isNaN(r.sent));
});

test('buildRunCounters: Infinity в tokens → 0', () => {
  const tokens = { calls: Infinity, promptTokens: Infinity, completionTokens: -Infinity };
  const r = buildRunCounters({ summary: {}, tokens });
  assert.equal(r.tokens.calls, 0);
  assert.equal(r.tokens.promptTokens, 0);
  assert.equal(r.tokens.completionTokens, 0);
  assert.equal(r.tokens.totalTokens, 0);
});

test('buildRunCounters: строки в полях → 0 (NaN → finite-guard)', () => {
  const summary = { viewed: 'много', applied: 'три', skipped: 'два' };
  const tokens  = { calls: 'семь', promptTokens: 'тыща', completionTokens: 'двести' };
  const r = buildRunCounters({ summary, tokens });
  assert.equal(r.viewed, 0);
  assert.equal(r.sent, 0);
  assert.equal(r.tokens.calls, 0);
  assert.equal(r.tokens.totalTokens, 0);
});

test('buildRunCounters: estimatedCostUsd = NaN → 0', () => {
  const tokens = { calls: 1, promptTokens: 10, completionTokens: 5, estimatedCostUsd: NaN };
  const r = buildRunCounters({ summary: {}, tokens });
  assert.equal(r.tokens.estimatedCostUsd, 0);
});

test('buildRunCounters: estimatedCostUsd = Infinity → 0', () => {
  const tokens = { calls: 1, promptTokens: 10, completionTokens: 5, estimatedCostUsd: Infinity };
  const r = buildRunCounters({ summary: {}, tokens });
  assert.equal(r.tokens.estimatedCostUsd, 0);
});

// ─── 7. totalTokens всегда пересчитывается ────────────────────────────────────

test('buildRunCounters: bogus totalTokens в tokens игнорируется — пересчёт prompt+completion', () => {
  const tokens = {
    calls: 1,
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 999, // должен быть проигнорирован
    cacheHitTokens: 0,
  };
  const r = buildRunCounters({ summary: {}, tokens });
  assert.equal(r.tokens.totalTokens, 30);  // 10 + 20
});

test('buildRunCounters: totalTokens = 0 когда prompt и completion оба 0', () => {
  const tokens = { calls: 5, promptTokens: 0, completionTokens: 0, totalTokens: 100 };
  const r = buildRunCounters({ summary: {}, tokens });
  assert.equal(r.tokens.totalTokens, 0);
});
