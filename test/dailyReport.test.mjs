import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDailyReport, dailyReportFileName } from '../src/lib/dailyReport.js';

// ─── dailyReportFileName ─────────────────────────────────────────────────────

test('dailyReportFileName: корректный формат для 2026-06-26', () => {
  const result = dailyReportFileName(new Date('2026-06-26T09:00:00Z'));
  assert.equal(result, 'daily-2026-06-26.json');
});

test('dailyReportFileName: zero-padding — одноцифровый месяц и день', () => {
  const result = dailyReportFileName(new Date('2026-01-05T00:00:00Z'));
  assert.equal(result, 'daily-2026-01-05.json');
});

test('dailyReportFileName: конец года', () => {
  const result = dailyReportFileName(new Date('2026-12-31T23:59:59Z'));
  assert.equal(result, 'daily-2026-12-31.json');
});

test('dailyReportFileName: начало UTC-дня (00:00 UTC = 03:00 МСК)', () => {
  // UTC-дата должна использоваться, не МСК
  const result = dailyReportFileName(new Date('2026-06-26T00:00:00Z'));
  assert.equal(result, 'daily-2026-06-26.json');
});

test('dailyReportFileName: невалидный Date → TypeError', () => {
  assert.throws(() => dailyReportFileName(new Date('invalid')), TypeError);
});

test('dailyReportFileName: не-Date (строка) → TypeError', () => {
  assert.throws(() => dailyReportFileName('2026-06-26'), TypeError);
});

test('dailyReportFileName: не-Date (null) → TypeError', () => {
  assert.throws(() => dailyReportFileName(null), TypeError);
});

test('dailyReportFileName: не-Date (undefined) → TypeError', () => {
  assert.throws(() => dailyReportFileName(undefined), TypeError);
});

// ─── createDailyReport: начальное состояние ──────────────────────────────────

test('createDailyReport: snapshot() без аргумента → date null, все нули', () => {
  const r = createDailyReport();
  const s = r.snapshot();
  assert.equal(s.date, null);
  assert.equal(s.accountsCount, 0);
  assert.deepEqual(s.accounts, []);
  assert.deepEqual(s.applications, { viewed: 0, applied: 0, skipped: 0, manual: 0, alreadyApplied: 0, dryRun: 0, errors: 0 });
  assert.deepEqual(s.messages, { processed: 0, replied: 0, skippedNoReply: 0, manual: 0 });
  assert.deepEqual(s.resume, { editsApplied: 0, editsSkipped: 0, addedSkillsTotal: 0 });
  assert.deepEqual(s.tokens, { promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, calls: 0 });
});

// ─── snapshot(date) ───────────────────────────────────────────────────────────

test('snapshot(date): корректная дата YYYY-MM-DD по UTC', () => {
  const r = createDailyReport();
  const s = r.snapshot(new Date('2026-06-26T09:00:00Z'));
  assert.equal(s.date, '2026-06-26');
});

test('snapshot(date): невалидный Date → date null (не бросает)', () => {
  const r = createDailyReport();
  assert.doesNotThrow(() => {
    const s = r.snapshot(new Date('invalid'));
    assert.equal(s.date, null);
  });
});

test('snapshot(date): не-Date аргумент → date null (не бросает)', () => {
  const r = createDailyReport();
  assert.doesNotThrow(() => {
    const s = r.snapshot('2026-06-26');
    assert.equal(s.date, null);
  });
});

test('snapshot(date): null аргумент → date null (не бросает)', () => {
  const r = createDailyReport();
  assert.doesNotThrow(() => {
    const s = r.snapshot(null);
    assert.equal(s.date, null);
  });
});

test('snapshot: accounts отсортирован', () => {
  const r = createDailyReport();
  r.recordAccountRun('zebra', { viewed: 1, applied: 1, skipped: 0, manual: 0, alreadyApplied: 0, dryRun: 0, errors: 0 });
  r.recordAccountRun('alpha', { viewed: 1, applied: 0, skipped: 1, manual: 0, alreadyApplied: 0, dryRun: 0, errors: 0 });
  r.recordAccountRun('mike', { viewed: 1, applied: 0, skipped: 0, manual: 1, alreadyApplied: 0, dryRun: 0, errors: 0 });
  const s = r.snapshot();
  assert.deepEqual(s.accounts, ['alpha', 'mike', 'zebra']);
});

// ─── recordAccountRun ─────────────────────────────────────────────────────────

test('recordAccountRun: суммирует числовые поля по нескольким аккаунтам', () => {
  const r = createDailyReport();
  r.recordAccountRun('acc1', { viewed: 10, applied: 3, skipped: 5, manual: 1, alreadyApplied: 0, dryRun: 1, errors: 0 });
  r.recordAccountRun('acc2', { viewed: 5, applied: 2, skipped: 1, manual: 0, alreadyApplied: 2, dryRun: 0, errors: 1 });
  const s = r.snapshot();
  assert.equal(s.applications.viewed, 15);
  assert.equal(s.applications.applied, 5);
  assert.equal(s.applications.skipped, 6);
  assert.equal(s.applications.manual, 1);
  assert.equal(s.applications.alreadyApplied, 2);
  assert.equal(s.applications.dryRun, 1);
  assert.equal(s.applications.errors, 1);
});

test('recordAccountRun: accountsCount считает уникальные имена', () => {
  const r = createDailyReport();
  r.recordAccountRun('acc1', { viewed: 1 });
  r.recordAccountRun('acc2', { viewed: 1 });
  r.recordAccountRun('acc1', { viewed: 1 }); // повтор
  const s = r.snapshot();
  assert.equal(s.accountsCount, 2);
});

test('recordAccountRun: повтор того же аккаунта суммирует числа, но не раздувает accountsCount', () => {
  const r = createDailyReport();
  r.recordAccountRun('acc1', { viewed: 10, applied: 3, skipped: 5, manual: 0, alreadyApplied: 0, dryRun: 0, errors: 0 });
  r.recordAccountRun('acc1', { viewed: 5, applied: 1, skipped: 2, manual: 0, alreadyApplied: 0, dryRun: 0, errors: 0 });
  const s = r.snapshot();
  assert.equal(s.accountsCount, 1);
  assert.equal(s.applications.viewed, 15);
  assert.equal(s.applications.applied, 4);
  assert.equal(s.applications.skipped, 7);
});

test('recordAccountRun: пустая строка как имя аккаунта → игнор (не бросает)', () => {
  const r = createDailyReport();
  assert.doesNotThrow(() => r.recordAccountRun('', { viewed: 5 }));
  assert.equal(r.snapshot().accountsCount, 0);
  assert.equal(r.snapshot().applications.viewed, 0);
});

test('recordAccountRun: не-строка как имя аккаунта → игнор (не бросает)', () => {
  const r = createDailyReport();
  assert.doesNotThrow(() => r.recordAccountRun(null, { viewed: 5 }));
  assert.doesNotThrow(() => r.recordAccountRun(42, { viewed: 5 }));
  assert.equal(r.snapshot().accountsCount, 0);
});

test('recordAccountRun: snapshot не объект → игнор (не бросает)', () => {
  const r = createDailyReport();
  assert.doesNotThrow(() => r.recordAccountRun('acc1', null));
  assert.doesNotThrow(() => r.recordAccountRun('acc2', 'строка'));
  assert.doesNotThrow(() => r.recordAccountRun('acc3', 42));
  assert.doesNotThrow(() => r.recordAccountRun('acc4', [1, 2, 3]));
  // имена аккаунтов не добавляются если snapshot мусор
  assert.equal(r.snapshot().accountsCount, 0);
});

test('recordAccountRun: нечисловые поля snapshot → 0 (не бросает)', () => {
  const r = createDailyReport();
  assert.doesNotThrow(() => r.recordAccountRun('acc1', { viewed: 'не число', applied: NaN, skipped: undefined }));
  const s = r.snapshot();
  assert.equal(s.applications.viewed, 0);
  assert.equal(s.applications.applied, 0);
  assert.equal(s.applications.skipped, 0);
  // счётчик аккаунта всё равно добавился (имя валидное, объект валидный)
  assert.equal(s.accountsCount, 1);
});

// ─── recordMessages ───────────────────────────────────────────────────────────

test('recordMessages: суммирует поля по нескольким вызовам', () => {
  const r = createDailyReport();
  r.recordMessages({ processed: 5, replied: 3, skippedNoReply: 1, manual: 1 });
  r.recordMessages({ processed: 3, replied: 2, skippedNoReply: 0, manual: 0 });
  const s = r.snapshot();
  assert.equal(s.messages.processed, 8);
  assert.equal(s.messages.replied, 5);
  assert.equal(s.messages.skippedNoReply, 1);
  assert.equal(s.messages.manual, 1);
});

test('recordMessages: нечисловые поля → 0 (не бросает)', () => {
  const r = createDailyReport();
  assert.doesNotThrow(() => r.recordMessages({ processed: 'пять', replied: NaN, skippedNoReply: null, manual: undefined }));
  const s = r.snapshot();
  assert.equal(s.messages.processed, 0);
  assert.equal(s.messages.replied, 0);
  assert.equal(s.messages.skippedNoReply, 0);
  assert.equal(s.messages.manual, 0);
});

test('recordMessages: не объект → игнор (не бросает)', () => {
  const r = createDailyReport();
  assert.doesNotThrow(() => r.recordMessages(null));
  assert.doesNotThrow(() => r.recordMessages('строка'));
  assert.doesNotThrow(() => r.recordMessages(42));
  assert.doesNotThrow(() => r.recordMessages([1, 2]));
  assert.equal(r.snapshot().messages.processed, 0);
});

test('recordMessages: без аргумента → игнор (не бросает)', () => {
  const r = createDailyReport();
  assert.doesNotThrow(() => r.recordMessages());
  assert.equal(r.snapshot().messages.processed, 0);
});

// ─── recordResumeEdit ─────────────────────────────────────────────────────────

test('recordResumeEdit: applied true → editsApplied++', () => {
  const r = createDailyReport();
  r.recordResumeEdit({ applied: true, addedSkillsCount: 2 });
  const s = r.snapshot();
  assert.equal(s.resume.editsApplied, 1);
  assert.equal(s.resume.editsSkipped, 0);
  assert.equal(s.resume.addedSkillsTotal, 2);
});

test('recordResumeEdit: applied false → editsSkipped++', () => {
  const r = createDailyReport();
  r.recordResumeEdit({ applied: false, addedSkillsCount: 0 });
  const s = r.snapshot();
  assert.equal(s.resume.editsApplied, 0);
  assert.equal(s.resume.editsSkipped, 1);
});

test('recordResumeEdit: applied undefined (не true) → editsSkipped++', () => {
  const r = createDailyReport();
  r.recordResumeEdit({ addedSkillsCount: 1 });
  const s = r.snapshot();
  assert.equal(s.resume.editsApplied, 0);
  assert.equal(s.resume.editsSkipped, 1);
});

test('recordResumeEdit: addedSkillsCount суммируется по нескольким вызовам', () => {
  const r = createDailyReport();
  r.recordResumeEdit({ applied: true, addedSkillsCount: 3 });
  r.recordResumeEdit({ applied: true, addedSkillsCount: 2 });
  r.recordResumeEdit({ applied: false, addedSkillsCount: 1 });
  const s = r.snapshot();
  assert.equal(s.resume.editsApplied, 2);
  assert.equal(s.resume.editsSkipped, 1);
  assert.equal(s.resume.addedSkillsTotal, 6);
});

test('recordResumeEdit: addedSkillsCount нечисловой → 0 (не бросает)', () => {
  const r = createDailyReport();
  assert.doesNotThrow(() => r.recordResumeEdit({ applied: true, addedSkillsCount: 'много' }));
  assert.equal(r.snapshot().resume.addedSkillsTotal, 0);
});

test('recordResumeEdit: не объект → игнор (не бросает)', () => {
  const r = createDailyReport();
  assert.doesNotThrow(() => r.recordResumeEdit(null));
  assert.doesNotThrow(() => r.recordResumeEdit(42));
  assert.doesNotThrow(() => r.recordResumeEdit([true]));
  const s = r.snapshot();
  assert.equal(s.resume.editsApplied, 0);
  assert.equal(s.resume.editsSkipped, 0);
});

test('recordResumeEdit: без аргумента → не бросает (editsSkipped++)', () => {
  const r = createDailyReport();
  assert.doesNotThrow(() => r.recordResumeEdit());
  // {} → applied не true → editsSkipped
  assert.equal(r.snapshot().resume.editsSkipped, 1);
});

// ─── recordTokens ─────────────────────────────────────────────────────────────

test('recordTokens: суммирует поля по нескольким вызовам (имена из usageCounter.js)', () => {
  const r = createDailyReport();
  // Поля: calls, promptTokens, completionTokens, cacheHitTokens — точно как в usageCounter snapshot
  r.recordTokens({ calls: 5, promptTokens: 1000, completionTokens: 300, cacheHitTokens: 100 });
  r.recordTokens({ calls: 3, promptTokens: 500, completionTokens: 150, cacheHitTokens: 50 });
  const s = r.snapshot();
  assert.equal(s.tokens.calls, 8);
  assert.equal(s.tokens.promptTokens, 1500);
  assert.equal(s.tokens.completionTokens, 450);
  assert.equal(s.tokens.cacheHitTokens, 150);
});

test('recordTokens: имена полей совпадают с usageCounter snapshot (структурная проверка)', () => {
  // Имитирует то, что вернёт createUsageCounter().snapshot()
  const usageSnap = { calls: 10, promptTokens: 2000, completionTokens: 600, totalTokens: 2600, cacheHitTokens: 200 };
  const r = createDailyReport();
  r.recordTokens(usageSnap);
  const s = r.snapshot();
  // calls, promptTokens, completionTokens, cacheHitTokens должны передаться без ошибок
  assert.equal(s.tokens.calls, 10);
  assert.equal(s.tokens.promptTokens, 2000);
  assert.equal(s.tokens.completionTokens, 600);
  assert.equal(s.tokens.cacheHitTokens, 200);
  // totalTokens не аккумулируется отдельно в dailyReport (производное)
});

test('recordTokens: нечисловые поля → 0 (не бросает)', () => {
  const r = createDailyReport();
  assert.doesNotThrow(() => r.recordTokens({ calls: 'много', promptTokens: NaN, completionTokens: null, cacheHitTokens: undefined }));
  const s = r.snapshot();
  assert.equal(s.tokens.calls, 0);
  assert.equal(s.tokens.promptTokens, 0);
  assert.equal(s.tokens.completionTokens, 0);
  assert.equal(s.tokens.cacheHitTokens, 0);
});

test('recordTokens: не объект → игнор (не бросает)', () => {
  const r = createDailyReport();
  assert.doesNotThrow(() => r.recordTokens(null));
  assert.doesNotThrow(() => r.recordTokens('строка'));
  assert.doesNotThrow(() => r.recordTokens(42));
  assert.doesNotThrow(() => r.recordTokens([100, 200]));
  assert.equal(r.snapshot().tokens.calls, 0);
});

// ─── formatLine ───────────────────────────────────────────────────────────────

test('formatLine: возвращает непустую строку', () => {
  const r = createDailyReport();
  const line = r.formatLine();
  assert.ok(typeof line === 'string' && line.length > 0, `ожидали непустую строку, получили: "${line}"`);
});

test('formatLine: содержит ключевые числа из snapshot', () => {
  const r = createDailyReport();
  r.recordAccountRun('acc1', { viewed: 20, applied: 7, skipped: 10, manual: 1, alreadyApplied: 0, dryRun: 1, errors: 1 });
  r.recordAccountRun('acc2', { viewed: 5, applied: 2, skipped: 1, manual: 0, alreadyApplied: 2, dryRun: 0, errors: 0 });
  r.recordMessages({ processed: 8, replied: 3, skippedNoReply: 4, manual: 1 });
  r.recordResumeEdit({ applied: true, addedSkillsCount: 2 });
  r.recordResumeEdit({ applied: false, addedSkillsCount: 0 });
  r.recordTokens({ calls: 50, promptTokens: 10000, completionTokens: 3000, cacheHitTokens: 500 });
  const line = r.formatLine();
  // accountsCount=2, applied=9, msgProcessed=8, resumeEdits=2, tokens=13000, calls=50
  assert.ok(line.includes('2'), `должна содержать "2" (аккаунтов): "${line}"`);
  assert.ok(line.includes('9'), `должна содержать "9" (откликов): "${line}"`);
  assert.ok(line.includes('8'), `должна содержать "8" (сообщений): "${line}"`);
  assert.ok(line.includes('50'), `должна содержать "50" (вызовов): "${line}"`);
});

// ─── Независимость инстансов ─────────────────────────────────────────────────

test('два createDailyReport() не делят состояние', () => {
  const a = createDailyReport();
  const b = createDailyReport();
  a.recordAccountRun('acc1', { viewed: 5, applied: 2, skipped: 1, manual: 0, alreadyApplied: 0, dryRun: 0, errors: 0 });
  a.recordTokens({ calls: 10, promptTokens: 500, completionTokens: 100, cacheHitTokens: 0 });
  assert.equal(a.snapshot().accountsCount, 1);
  assert.equal(b.snapshot().accountsCount, 0);
  assert.equal(a.snapshot().tokens.calls, 10);
  assert.equal(b.snapshot().tokens.calls, 0);
});

// ─── Полный сценарий ──────────────────────────────────────────────────────────

test('полный сценарий: несколько record* → snapshot отражает все агрегаты', () => {
  const r = createDailyReport();
  const date = new Date('2026-06-26T06:00:00Z');

  // Три прогона аккаунтов (acc1 дважды)
  r.recordAccountRun('acc1', { viewed: 30, applied: 10, skipped: 15, manual: 2, alreadyApplied: 1, dryRun: 0, errors: 2 });
  r.recordAccountRun('acc2', { viewed: 20, applied: 5, skipped: 10, manual: 0, alreadyApplied: 3, dryRun: 2, errors: 0 });
  r.recordAccountRun('acc1', { viewed: 5, applied: 2, skipped: 2, manual: 0, alreadyApplied: 0, dryRun: 0, errors: 1 });

  // Два раунда сообщений
  r.recordMessages({ processed: 10, replied: 6, skippedNoReply: 3, manual: 1 });
  r.recordMessages({ processed: 5, replied: 2, skippedNoReply: 2, manual: 1 });

  // Три правки резюме
  r.recordResumeEdit({ applied: true, addedSkillsCount: 3 });
  r.recordResumeEdit({ applied: true, addedSkillsCount: 2 });
  r.recordResumeEdit({ applied: false, addedSkillsCount: 0 });

  // Два блока токенов
  r.recordTokens({ calls: 40, promptTokens: 8000, completionTokens: 2000, cacheHitTokens: 400 });
  r.recordTokens({ calls: 20, promptTokens: 4000, completionTokens: 1000, cacheHitTokens: 200 });

  // Мусорные вызовы — не должны ничего сломать
  r.recordAccountRun('', null);
  r.recordMessages(null);
  r.recordResumeEdit(null);
  r.recordTokens(null);

  const s = r.snapshot(date);

  assert.equal(s.date, '2026-06-26');
  assert.equal(s.accountsCount, 2);
  assert.deepEqual(s.accounts, ['acc1', 'acc2']);

  // applications: acc1×2 + acc2
  assert.equal(s.applications.viewed, 55);
  assert.equal(s.applications.applied, 17);
  assert.equal(s.applications.skipped, 27);
  assert.equal(s.applications.manual, 2);
  assert.equal(s.applications.alreadyApplied, 4);
  assert.equal(s.applications.dryRun, 2);
  assert.equal(s.applications.errors, 3);

  // messages: два раунда
  assert.equal(s.messages.processed, 15);
  assert.equal(s.messages.replied, 8);
  assert.equal(s.messages.skippedNoReply, 5);
  assert.equal(s.messages.manual, 2);

  // resume: 2 applied + 1 skipped
  assert.equal(s.resume.editsApplied, 2);
  assert.equal(s.resume.editsSkipped, 1);
  assert.equal(s.resume.addedSkillsTotal, 5);

  // tokens: два блока
  assert.equal(s.tokens.calls, 60);
  assert.equal(s.tokens.promptTokens, 12000);
  assert.equal(s.tokens.completionTokens, 3000);
  assert.equal(s.tokens.cacheHitTokens, 600);
});
