import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDaemonArgs, buildReviewChildArgs } from '../src/lib/daemonArgs.js';

// Все тесты детерминированы: без IO, сети, Date.now().

// ============================================================
// parseDaemonArgs — ДЕФОЛТЫ
// ============================================================

test('parseDaemonArgs: без аргументов → дефолты безопасны', () => {
  const opts = parseDaemonArgs([]);
  assert.equal(opts.dryRun, true, 'dryRun дефолт ДОЛЖЕН быть true (КРИТИЧНО)');
  assert.equal(opts.replyAuto, false, 'replyAuto дефолт false');
  assert.deepEqual(opts.accounts, ['default'], 'accounts дефолт [default]');
  assert.equal(opts.limit, 200, 'limit дефолт 200');
  assert.equal(opts.area, '1', 'area дефолт "1"');
  assert.equal(opts.text, '', 'text дефолт ""');
  assert.equal(opts.search, '', 'search дефолт ""');
  assert.equal(opts.once, false, 'once дефолт false');
  assert.equal(opts.messagesPollMinutes, 15, 'messagesPollMinutes дефолт 15');
  assert.equal(opts.microEditMinutes, 30, 'microEditMinutes дефолт 30');
});

test('parseDaemonArgs: undefined → дефолты (не бросает)', () => {
  const opts = parseDaemonArgs(undefined);
  assert.equal(opts.dryRun, true);
  assert.equal(opts.limit, 200);
});

test('parseDaemonArgs: null → дефолты (не бросает)', () => {
  const opts = parseDaemonArgs(null);
  assert.equal(opts.dryRun, true);
  assert.deepEqual(opts.accounts, ['default']);
});

// ============================================================
// parseDaemonArgs — dryRun opt-in в live-режим
// ============================================================

test('parseDaemonArgs: --no-dry-run → dryRun false (явный opt-in)', () => {
  const opts = parseDaemonArgs(['--no-dry-run']);
  assert.equal(opts.dryRun, false, '--no-dry-run должен выключать dryRun');
});

test('parseDaemonArgs: --live → dryRun false (явный opt-in)', () => {
  const opts = parseDaemonArgs(['--live']);
  assert.equal(opts.dryRun, false, '--live должен выключать dryRun');
});

test('parseDaemonArgs: без --no-dry-run / --live → dryRun остаётся true', () => {
  const opts = parseDaemonArgs(['--accounts', 'myacc', '--limit', '50']);
  assert.equal(opts.dryRun, true, 'без явного opt-in dryRun=true');
});

// ============================================================
// parseDaemonArgs — boolean флаги
// ============================================================

test('parseDaemonArgs: --reply-auto → replyAuto true', () => {
  const opts = parseDaemonArgs(['--reply-auto']);
  assert.equal(opts.replyAuto, true);
});

test('parseDaemonArgs: --once → once true', () => {
  const opts = parseDaemonArgs(['--once']);
  assert.equal(opts.once, true);
});

// ============================================================
// parseDaemonArgs — accounts
// ============================================================

test('parseDaemonArgs: --accounts a,b,c → [a, b, c]', () => {
  const opts = parseDaemonArgs(['--accounts', 'a,b,c']);
  assert.deepEqual(opts.accounts, ['a', 'b', 'c']);
});

test('parseDaemonArgs: --account x → [x]', () => {
  const opts = parseDaemonArgs(['--account', 'myaccount']);
  assert.deepEqual(opts.accounts, ['myaccount']);
});

test('parseDaemonArgs: --accounts с пробелами вокруг запятых → trim', () => {
  const opts = parseDaemonArgs(['--accounts', ' acc1 , acc2 ']);
  assert.deepEqual(opts.accounts, ['acc1', 'acc2']);
});

test('parseDaemonArgs: --accounts пустая строка → ["default"]', () => {
  const opts = parseDaemonArgs(['--accounts', '']);
  assert.deepEqual(opts.accounts, ['default']);
});

// ============================================================
// parseDaemonArgs — --limit валидация
// ============================================================

test('parseDaemonArgs: --limit 50 → limit 50', () => {
  const opts = parseDaemonArgs(['--limit', '50']);
  assert.equal(opts.limit, 50);
});

test('parseDaemonArgs: --limit 0 → throw (не положительный)', () => {
  assert.throws(
    () => parseDaemonArgs(['--limit', '0']),
    /Параметр --limit/,
  );
});

test('parseDaemonArgs: --limit -5 → throw (отрицательный)', () => {
  assert.throws(
    () => parseDaemonArgs(['--limit', '-5']),
    /Параметр --limit/,
  );
});

test('parseDaemonArgs: --limit мусор ("abc") → throw', () => {
  assert.throws(
    () => parseDaemonArgs(['--limit', 'abc']),
    /Параметр --limit/,
  );
});

test('parseDaemonArgs: --limit пустая строка → throw', () => {
  assert.throws(
    () => parseDaemonArgs(['--limit', '']),
    /Параметр --limit/,
  );
});

// ============================================================
// parseDaemonArgs — интервалы
// ============================================================

test('parseDaemonArgs: --messages-interval 10 → messagesPollMinutes 10', () => {
  const opts = parseDaemonArgs(['--messages-interval', '10']);
  assert.equal(opts.messagesPollMinutes, 10);
});

test('parseDaemonArgs: --micro-edit-interval 45 → microEditMinutes 45', () => {
  const opts = parseDaemonArgs(['--micro-edit-interval', '45']);
  assert.equal(opts.microEditMinutes, 45);
});

test('parseDaemonArgs: --messages-interval мусор → дефолт 15 (не бросает)', () => {
  const opts = parseDaemonArgs(['--messages-interval', 'bad']);
  assert.equal(opts.messagesPollMinutes, 15);
});

test('parseDaemonArgs: --micro-edit-interval 0 → дефолт 30 (не бросает, 0 не > 0)', () => {
  const opts = parseDaemonArgs(['--micro-edit-interval', '0']);
  assert.equal(opts.microEditMinutes, 30);
});

// ============================================================
// parseDaemonArgs — прочие поля
// ============================================================

test('parseDaemonArgs: --text DevOps → text "DevOps"', () => {
  const opts = parseDaemonArgs(['--text', 'DevOps']);
  assert.equal(opts.text, 'DevOps');
});

test('parseDaemonArgs: --area 2 → area "2"', () => {
  const opts = parseDaemonArgs(['--area', '2']);
  assert.equal(opts.area, '2');
});

test('parseDaemonArgs: --search url → search url', () => {
  const opts = parseDaemonArgs(['--search', 'https://hh.ru/search/vacancy?text=go']);
  assert.equal(opts.search, 'https://hh.ru/search/vacancy?text=go');
});

test('parseDaemonArgs: неизвестные флаги игнорируются, дефолты сохраняются', () => {
  const opts = parseDaemonArgs(['--unknown-flag', '--another', 'value']);
  assert.equal(opts.dryRun, true);
  assert.equal(opts.limit, 200);
});

test('parseDaemonArgs: комбинация --live --reply-auto --once --accounts a,b --limit 100', () => {
  const opts = parseDaemonArgs([
    '--live', '--reply-auto', '--once',
    '--accounts', 'a,b',
    '--limit', '100',
    '--text', 'Golang',
  ]);
  assert.equal(opts.dryRun, false);
  assert.equal(opts.replyAuto, true);
  assert.equal(opts.once, true);
  assert.deepEqual(opts.accounts, ['a', 'b']);
  assert.equal(opts.limit, 100);
  assert.equal(opts.text, 'Golang');
});

// ============================================================
// buildReviewChildArgs — безопасность dry-run (КРИТИЧНО)
// ============================================================

test('buildReviewChildArgs: dryRun=true → содержит "--dry-run" (КРИТИЧНО)', () => {
  const argv = buildReviewChildArgs({ accounts: ['acc1'], limit: 200, dryRun: true });
  assert.ok(argv.includes('--dry-run'), 'dryRun=true ДОЛЖЕН давать --dry-run');
});

test('buildReviewChildArgs: dryRun=true → содержит "--manual" (двойная защита)', () => {
  const argv = buildReviewChildArgs({ accounts: ['acc1'], limit: 200, dryRun: true });
  assert.ok(argv.includes('--manual'), 'dryRun=true ДОЛЖЕН давать --manual');
});

test('buildReviewChildArgs: dryRun=true → НЕ содержит "--yes" (КРИТИЧНО)', () => {
  const argv = buildReviewChildArgs({ accounts: ['acc1'], limit: 200, dryRun: true });
  assert.ok(!argv.includes('--yes'), 'dryRun=true НЕ ДОЛЖЕН давать --yes');
});

test('buildReviewChildArgs: дефолт opts → dryRun=true по умолчанию (--dry-run + --manual)', () => {
  const argv = buildReviewChildArgs({ accounts: ['x'] });
  assert.ok(argv.includes('--dry-run'));
  assert.ok(argv.includes('--manual'));
  assert.ok(!argv.includes('--yes'));
});

// ============================================================
// buildReviewChildArgs — live-режим
// ============================================================

test('buildReviewChildArgs: dryRun=false + autoApply=true → содержит "--yes"', () => {
  const argv = buildReviewChildArgs({ accounts: ['acc1'], limit: 50, dryRun: false, autoApply: true });
  assert.ok(argv.includes('--yes'), '!dryRun+autoApply → --yes');
});

test('buildReviewChildArgs: dryRun=false + autoApply=true → НЕ содержит "--dry-run"', () => {
  const argv = buildReviewChildArgs({ accounts: ['acc1'], limit: 50, dryRun: false, autoApply: true });
  assert.ok(!argv.includes('--dry-run'), 'live-режим НЕ должен давать --dry-run');
});

test('buildReviewChildArgs: dryRun=false + autoApply=false → нет ни --yes, ни --dry-run', () => {
  const argv = buildReviewChildArgs({ accounts: ['acc1'], limit: 50, dryRun: false, autoApply: false });
  assert.ok(!argv.includes('--yes'));
  assert.ok(!argv.includes('--dry-run'));
  assert.ok(!argv.includes('--manual'));
});

// ============================================================
// buildReviewChildArgs — обязательные поля
// ============================================================

test('buildReviewChildArgs: всегда содержит --accounts', () => {
  const argv = buildReviewChildArgs({ accounts: ['a', 'b'], limit: 100, dryRun: true });
  const idx = argv.indexOf('--accounts');
  assert.ok(idx !== -1, '--accounts должен присутствовать');
  assert.equal(argv[idx + 1], 'a,b', 'accounts join через запятую');
});

test('buildReviewChildArgs: всегда содержит --limit', () => {
  const argv = buildReviewChildArgs({ accounts: ['x'], limit: 77, dryRun: true });
  const idx = argv.indexOf('--limit');
  assert.ok(idx !== -1, '--limit должен присутствовать');
  assert.equal(argv[idx + 1], '77');
});

// ============================================================
// buildReviewChildArgs — text/search не добавляются если пустые
// ============================================================

test('buildReviewChildArgs: text пустой → --text отсутствует', () => {
  const argv = buildReviewChildArgs({ accounts: ['x'], limit: 100, dryRun: true, text: '' });
  assert.ok(!argv.includes('--text'), '--text не должен добавляться при пустом значении');
});

test('buildReviewChildArgs: search пустой → --search отсутствует', () => {
  const argv = buildReviewChildArgs({ accounts: ['x'], limit: 100, dryRun: true, search: '' });
  assert.ok(!argv.includes('--search'));
});

test('buildReviewChildArgs: text задан → добавляется', () => {
  const argv = buildReviewChildArgs({ accounts: ['x'], limit: 100, dryRun: true, text: 'DevOps' });
  const idx = argv.indexOf('--text');
  assert.ok(idx !== -1, '--text должен добавляться при непустом значении');
  assert.equal(argv[idx + 1], 'DevOps');
});

test('buildReviewChildArgs: search задан → добавляется', () => {
  const argv = buildReviewChildArgs({
    accounts: ['x'], limit: 100, dryRun: true,
    search: 'https://hh.ru/search/vacancy?text=go',
  });
  const idx = argv.indexOf('--search');
  assert.ok(idx !== -1);
  assert.equal(argv[idx + 1], 'https://hh.ru/search/vacancy?text=go');
});

// ============================================================
// buildReviewChildArgs — accounts join
// ============================================================

test('buildReviewChildArgs: accounts=[a,b,c] → "a,b,c" в argv', () => {
  const argv = buildReviewChildArgs({ accounts: ['a', 'b', 'c'], limit: 50, dryRun: true });
  const idx = argv.indexOf('--accounts');
  assert.equal(argv[idx + 1], 'a,b,c');
});

test('buildReviewChildArgs: accounts=[single] → "single" в argv', () => {
  const argv = buildReviewChildArgs({ accounts: ['myacc'], limit: 50, dryRun: false });
  const idx = argv.indexOf('--accounts');
  assert.equal(argv[idx + 1], 'myacc');
});

// ============================================================
// buildReviewChildArgs — area передаётся
// ============================================================

test('buildReviewChildArgs: area="2" → --area 2 в argv', () => {
  const argv = buildReviewChildArgs({ accounts: ['x'], limit: 50, dryRun: true, area: '2' });
  const idx = argv.indexOf('--area');
  assert.ok(idx !== -1, '--area должен присутствовать');
  assert.equal(argv[idx + 1], '2');
});
