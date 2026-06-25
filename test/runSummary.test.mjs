import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunSummary } from '../src/lib/runSummary.js';

// --- начальное состояние ---

test('createRunSummary: новый summary → snapshot нули, viewed 0', () => {
  const s = createRunSummary();
  assert.deepEqual(s.snapshot(), {
    viewed: 0,
    applied: 0,
    skipped: 0,
    manual: 0,
    alreadyApplied: 0,
    dryRun: 0,
    errors: 0,
    quit: 0,
    locallyScored: 0,
    modelScored: 0,
    cachedScored: 0,
  });
});

// --- record: статусы ---

test('record clicked → applied++, viewed++', () => {
  const s = createRunSummary();
  s.record({ status: 'clicked' });
  const snap = s.snapshot();
  assert.equal(snap.viewed, 1);
  assert.equal(snap.applied, 1);
  assert.equal(snap.skipped, 0);
});

test('record skipped → skipped++, viewed++', () => {
  const s = createRunSummary();
  s.record({ status: 'skipped' });
  const snap = s.snapshot();
  assert.equal(snap.viewed, 1);
  assert.equal(snap.skipped, 1);
  assert.equal(snap.applied, 0);
});

test('record manual_needed → manual++, viewed++', () => {
  const s = createRunSummary();
  s.record({ status: 'manual_needed' });
  const snap = s.snapshot();
  assert.equal(snap.viewed, 1);
  assert.equal(snap.manual, 1);
});

test('record already_applied → alreadyApplied++, viewed++', () => {
  const s = createRunSummary();
  s.record({ status: 'already_applied' });
  const snap = s.snapshot();
  assert.equal(snap.viewed, 1);
  assert.equal(snap.alreadyApplied, 1);
});

test('record dry_run → dryRun++, viewed++', () => {
  const s = createRunSummary();
  s.record({ status: 'dry_run' });
  const snap = s.snapshot();
  assert.equal(snap.viewed, 1);
  assert.equal(snap.dryRun, 1);
});

test('record error → errors++, viewed++', () => {
  const s = createRunSummary();
  s.record({ status: 'error' });
  const snap = s.snapshot();
  assert.equal(snap.viewed, 1);
  assert.equal(snap.errors, 1);
});

test('record quit → quit++, viewed++', () => {
  const s = createRunSummary();
  s.record({ status: 'quit' });
  const snap = s.snapshot();
  assert.equal(snap.viewed, 1);
  assert.equal(snap.quit, 1);
});

// --- viewed растёт на каждый record ---

test('viewed инкрементируется на каждый record', () => {
  const s = createRunSummary();
  s.record({ status: 'clicked' });
  s.record({ status: 'skipped' });
  s.record({ status: 'error' });
  assert.equal(s.snapshot().viewed, 3);
});

// --- scoredBy ---

test('scoredBy local → locallyScored++', () => {
  const s = createRunSummary();
  s.record({ status: 'skipped', scoredBy: 'local' });
  assert.equal(s.snapshot().locallyScored, 1);
  assert.equal(s.snapshot().modelScored, 0);
  assert.equal(s.snapshot().cachedScored, 0);
});

test('scoredBy model → modelScored++', () => {
  const s = createRunSummary();
  s.record({ status: 'clicked', scoredBy: 'model' });
  assert.equal(s.snapshot().modelScored, 1);
  assert.equal(s.snapshot().locallyScored, 0);
});

test('scoredBy cache → cachedScored++', () => {
  const s = createRunSummary();
  s.record({ status: 'clicked', scoredBy: 'cache' });
  assert.equal(s.snapshot().cachedScored, 1);
  assert.equal(s.snapshot().modelScored, 0);
});

test('без scoredBy — счётчики скоринга не растут', () => {
  const s = createRunSummary();
  s.record({ status: 'already_applied' });
  const snap = s.snapshot();
  assert.equal(snap.locallyScored, 0);
  assert.equal(snap.modelScored, 0);
  assert.equal(snap.cachedScored, 0);
});

// --- защита от невалидных аргументов ---

test('record(null) → не бросает, viewed не меняется', () => {
  const s = createRunSummary();
  assert.doesNotThrow(() => s.record(null));
  assert.equal(s.snapshot().viewed, 0);
});

test('record(undefined) → не бросает, viewed не меняется', () => {
  const s = createRunSummary();
  assert.doesNotThrow(() => s.record(undefined));
  assert.equal(s.snapshot().viewed, 0);
});

test('record(42) → не бросает, viewed не меняется', () => {
  const s = createRunSummary();
  assert.doesNotThrow(() => s.record(42));
  assert.equal(s.snapshot().viewed, 0);
});

test('record({}) → не бросает, viewed++, статус-счётчики не растут', () => {
  const s = createRunSummary();
  assert.doesNotThrow(() => s.record({}));
  const snap = s.snapshot();
  assert.equal(snap.viewed, 1);
  assert.equal(snap.applied, 0);
  assert.equal(snap.skipped, 0);
  assert.equal(snap.errors, 0);
});

// --- formatLine ---

test('formatLine → непустая строка', () => {
  const s = createRunSummary();
  s.record({ status: 'clicked', scoredBy: 'model' });
  s.record({ status: 'skipped', scoredBy: 'local' });
  const line = s.formatLine();
  assert.ok(typeof line === 'string' && line.length > 0, `ожидали непустую строку, получили: "${line}"`);
});

test('formatLine содержит числа из snapshot', () => {
  const s = createRunSummary();
  s.record({ status: 'clicked', scoredBy: 'model' });
  s.record({ status: 'skipped', scoredBy: 'local' });
  s.record({ status: 'error' });
  const line = s.formatLine();
  // viewed=3, applied=1, skipped=1, errors=1, locallyScored=1, modelScored=1
  assert.ok(line.includes('3'), `formatLine должна содержать viewed=3: "${line}"`);
  assert.ok(line.includes('1'), `formatLine должна содержать 1 в нескольких полях: "${line}"`);
});

// --- независимость инстансов ---

test('два createRunSummary() не делят состояние', () => {
  const a = createRunSummary();
  const b = createRunSummary();
  a.record({ status: 'clicked' });
  assert.equal(a.snapshot().viewed, 1);
  assert.equal(b.snapshot().viewed, 0);
  assert.equal(b.snapshot().applied, 0);
});
