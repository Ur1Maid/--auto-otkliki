import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlerts, DEFAULT_THRESHOLDS } from '../src/lib/alerts.js';

// Хелпер: минимальный снапшот dailyReport с переопределениями.
function snap({ apps = {}, msgs = {}, tok = {} } = {}) {
  return {
    applications: { viewed: 0, applied: 0, errors: 0, ...apps },
    messages: { manual: 0, ...msgs },
    tokens: { apiErrors: 0, balanceExhausted: false, ...tok },
  };
}

const codes = (alerts) => alerts.map((a) => a.code);

// --- чистый/здоровый день → нет алертов ---
test('здоровый день → нет алертов', () => {
  const a = evaluateAlerts(snap({ apps: { viewed: 50, applied: 20, errors: 0 } }));
  assert.deepEqual(a, []);
});

// --- баланс 402 ---
test('balanceExhausted → critical deepseek_balance', () => {
  const a = evaluateAlerts(snap({ tok: { balanceExhausted: true } }));
  const bal = a.find((x) => x.code === 'deepseek_balance');
  assert.ok(bal, 'должен быть алерт баланса');
  assert.equal(bal.level, 'critical');
});

// --- сломанный поток откликов ---
test('просмотрено много, откликов 0, ошибки есть → critical flow_broken', () => {
  const a = evaluateAlerts(snap({ apps: { viewed: 30, applied: 0, errors: 4 } }));
  const fb = a.find((x) => x.code === 'flow_broken');
  assert.ok(fb);
  assert.equal(fb.level, 'critical');
});

test('просмотрено много, откликов 0, но БЕЗ ошибок → НЕ flow_broken (просто нерелевантно)', () => {
  const a = evaluateAlerts(snap({ apps: { viewed: 30, applied: 0, errors: 0 } }));
  assert.ok(!codes(a).includes('flow_broken'));
});

test('мало просмотров → flow_broken не срабатывает (нет статистики)', () => {
  const a = evaluateAlerts(snap({ apps: { viewed: 2, applied: 0, errors: 1 } }));
  assert.ok(!codes(a).includes('flow_broken'));
});

// --- пороги warn ---
test('apiErrors >= порога → warn api_errors', () => {
  const a = evaluateAlerts(snap({ tok: { apiErrors: DEFAULT_THRESHOLDS.maxApiErrors } }));
  const w = a.find((x) => x.code === 'api_errors');
  assert.ok(w);
  assert.equal(w.level, 'warn');
});

test('errors >= порога → warn apply_errors', () => {
  const a = evaluateAlerts(snap({ apps: { viewed: 100, applied: 50, errors: DEFAULT_THRESHOLDS.maxErrors } }));
  assert.ok(codes(a).includes('apply_errors'));
});

test('manual >= порога → warn messages_manual', () => {
  const a = evaluateAlerts(snap({ msgs: { manual: DEFAULT_THRESHOLDS.maxManual } }));
  assert.ok(codes(a).includes('messages_manual'));
});

// --- кастомные пороги ---
test('кастомные пороги переопределяют дефолт', () => {
  const a = evaluateAlerts(snap({ apps: { errors: 2, viewed: 100, applied: 50 } }), { maxErrors: 2 });
  assert.ok(codes(a).includes('apply_errors'));
});

// --- защита от мусора ---
test('не объект / null → [] (не бросает)', () => {
  assert.deepEqual(evaluateAlerts(null), []);
  assert.deepEqual(evaluateAlerts('x'), []);
  assert.deepEqual(evaluateAlerts(undefined), []);
});

test('снапшот без секций → не бросает, нет ложных алертов', () => {
  assert.doesNotThrow(() => evaluateAlerts({}));
  assert.deepEqual(evaluateAlerts({}), []);
});

// --- несколько алертов сразу ---
test('баланс + сломанный поток → оба critical', () => {
  const a = evaluateAlerts(snap({ apps: { viewed: 30, applied: 0, errors: 5 }, tok: { balanceExhausted: true, apiErrors: 5 } }));
  const c = codes(a);
  assert.ok(c.includes('deepseek_balance'));
  assert.ok(c.includes('flow_broken'));
  assert.ok(c.includes('api_errors'));
  assert.ok(a.every((x) => x.level === 'critical' || x.level === 'warn'));
});
