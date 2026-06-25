import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyBumpButton, bumpResume } from '../src/lib/resumeBump.js';

// ─── Вспомогательная фабрика мок-фрейма ─────────────────────────────────────
// Возвращает объект с совместимым с Playwright Page/Frame API.
// clickCount — замыкание для проверки «click не был вызван».
function makeFrame({ visible = true, enabled = true, text = 'Поднять в поиске', throwOnClick = false, selector: expectedSel } = {}) {
  let clickCount = 0;
  let lastSel = null;

  const btn = {
    isVisible: async () => visible,
    isEnabled: async () => enabled,
    innerText: async () => text,
    click: async () => {
      if (throwOnClick) throw new Error('click-error');
      clickCount++;
    },
  };

  const frame = {
    locator(sel) {
      lastSel = sel;
      return btn;
    },
    _clickCount: () => clickCount,
    _lastSel: () => lastSel,
  };

  return frame;
}

// ─── classifyBumpButton ───────────────────────────────────────────────────────

test('classifyBumpButton: кнопка отсутствует → not_found', () => {
  const r = classifyBumpButton({ visible: false, enabled: true, text: 'Поднять в поиске' });
  assert.equal(r.canBump, false);
  assert.equal(r.reason, 'not_found');
});

test('classifyBumpButton: visible undefined → not_found', () => {
  const r = classifyBumpButton({ enabled: true, text: 'Поднять в поиске' });
  assert.equal(r.canBump, false);
  assert.equal(r.reason, 'not_found');
});

test('classifyBumpButton: текст кулдауна → cooldown (даже если visible+enabled)', () => {
  const r = classifyBumpButton({ visible: true, enabled: true, text: 'Обновить можно через 3 часа' });
  assert.equal(r.canBump, false);
  assert.equal(r.reason, 'cooldown');
});

test('classifyBumpButton: кулдаун с другим вариантом текста', () => {
  const r = classifyBumpButton({ visible: true, enabled: true, text: 'Обновить можно через 20 минут' });
  assert.equal(r.canBump, false);
  assert.equal(r.reason, 'cooldown');
});

test('classifyBumpButton: «Поднять в поиске» + enabled:true → canBump:true, reason:ready', () => {
  const r = classifyBumpButton({ visible: true, enabled: true, text: 'Поднять в поиске' });
  assert.equal(r.canBump, true);
  assert.equal(r.reason, 'ready');
});

test('classifyBumpButton: «Обновить дату» + enabled → canBump:true, reason:ready', () => {
  const r = classifyBumpButton({ visible: true, enabled: true, text: 'Обновить дату' });
  assert.equal(r.canBump, true);
  assert.equal(r.reason, 'ready');
});

test('classifyBumpButton: «Поднять в поиске» + enabled:false → disabled (не ready)', () => {
  // Порядок ветвей: cooldown не совпадает, ready-ветвь требует enabled!==false → не проходит,
  // затем enabled===false → reason:'disabled'.
  const r = classifyBumpButton({ visible: true, enabled: false, text: 'Поднять в поиске' });
  assert.equal(r.canBump, false);
  assert.equal(r.reason, 'disabled');
});

test('classifyBumpButton: нераспознанный текст + visible+enabled → unknown', () => {
  const r = classifyBumpButton({ visible: true, enabled: true, text: 'Опубликовать' });
  assert.equal(r.canBump, false);
  assert.equal(r.reason, 'unknown');
});

test('classifyBumpButton: нераспознанный текст + visible+enabled:false → disabled', () => {
  const r = classifyBumpButton({ visible: true, enabled: false, text: 'Опубликовать' });
  assert.equal(r.canBump, false);
  assert.equal(r.reason, 'disabled');
});

test('classifyBumpButton: text не строка (число) → не падает, reason unknown', () => {
  const r = classifyBumpButton({ visible: true, enabled: true, text: 42 });
  assert.equal(r.canBump, false);
  assert.equal(r.reason, 'unknown');
});

test('classifyBumpButton: text не строка (null) → не падает, reason unknown', () => {
  const r = classifyBumpButton({ visible: true, enabled: true, text: null });
  assert.equal(r.canBump, false);
  assert.equal(r.reason, 'unknown');
});

test('classifyBumpButton: text не строка (undefined) → не падает, reason unknown', () => {
  const r = classifyBumpButton({ visible: true, enabled: true, text: undefined });
  assert.equal(r.canBump, false);
  assert.equal(r.reason, 'unknown');
});

test('classifyBumpButton: вызов без аргументов → не падает, not_found', () => {
  const r = classifyBumpButton();
  assert.equal(r.canBump, false);
  assert.equal(r.reason, 'not_found');
});

// ─── bumpResume ───────────────────────────────────────────────────────────────

// КРИТИЧНЫЙ safety-тест: dry-run по умолчанию, кнопка ready → click НЕ вызван.
test('bumpResume: dry-run дефолт (dryRun не передан), кнопка ready → click НЕ вызван, reason dry_run', async () => {
  const frame = makeFrame({ visible: true, enabled: true, text: 'Поднять в поиске' });
  const result = await bumpResume(frame); // dryRun не передан — должен быть true
  assert.equal(result.bumped, false);
  assert.equal(result.reason, 'dry_run');
  assert.equal(frame._clickCount(), 0); // клика нет
});

// Явный dryRun:true — тот же результат.
test('bumpResume: dryRun:true явный, кнопка ready → click НЕ вызван', async () => {
  const frame = makeFrame({ visible: true, enabled: true, text: 'Поднять в поиске' });
  const result = await bumpResume(frame, { dryRun: true });
  assert.equal(result.bumped, false);
  assert.equal(result.reason, 'dry_run');
  assert.equal(frame._clickCount(), 0);
});

// Кулдаун → не жмём (даже с dryRun:false canBump гасит раньше dry-run-проверки).
test('bumpResume: cooldown + dryRun:false → click НЕ вызван, reason cooldown', async () => {
  const frame = makeFrame({ visible: true, enabled: true, text: 'Обновить можно через 3 часа' });
  const result = await bumpResume(frame, { dryRun: false });
  assert.equal(result.bumped, false);
  assert.equal(result.reason, 'cooldown');
  assert.equal(frame._clickCount(), 0);
});

// Кнопки нет → не жмём.
test('bumpResume: not visible → click НЕ вызван, reason not_found', async () => {
  const frame = makeFrame({ visible: false });
  const result = await bumpResume(frame, { dryRun: false });
  assert.equal(result.bumped, false);
  assert.equal(result.reason, 'not_found');
  assert.equal(frame._clickCount(), 0);
});

// Реальный клик: dryRun:false + ready → click вызван 1 раз, bumped:true.
test('bumpResume: dryRun:false + ready → click вызван 1 раз, bumped:true, reason clicked', async () => {
  const frame = makeFrame({ visible: true, enabled: true, text: 'Поднять в поиске' });
  const result = await bumpResume(frame, { dryRun: false });
  assert.equal(result.bumped, true);
  assert.equal(result.reason, 'clicked');
  assert.equal(frame._clickCount(), 1);
});

// disabled + dryRun:false → не жмём (canBump:false блокирует до dry-run).
test('bumpResume: disabled + dryRun:false → click НЕ вызван, reason disabled', async () => {
  const frame = makeFrame({ visible: true, enabled: false, text: 'Поднять в поиске' });
  const result = await bumpResume(frame, { dryRun: false });
  assert.equal(result.bumped, false);
  assert.equal(result.reason, 'disabled');
  assert.equal(frame._clickCount(), 0);
});

// unknown текст + dryRun:false → не жмём.
test('bumpResume: unknown текст + dryRun:false → click НЕ вызван, reason unknown', async () => {
  const frame = makeFrame({ visible: true, enabled: true, text: 'Опубликовать' });
  const result = await bumpResume(frame, { dryRun: false });
  assert.equal(result.bumped, false);
  assert.equal(result.reason, 'unknown');
  assert.equal(frame._clickCount(), 0);
});

// click бросает (dryRun:false, ready) → reason 'error', наружу не бросает.
test('bumpResume: click бросает → reason error, не бросает наружу, bumped:false', async () => {
  const frame = makeFrame({ visible: true, enabled: true, text: 'Поднять в поиске', throwOnClick: true });
  const result = await bumpResume(frame, { dryRun: false });
  assert.equal(result.bumped, false);
  assert.equal(result.reason, 'error');
});

// Кастомный selector уважается.
test('bumpResume: кастомный selector → frame.locator вызван с ним', async () => {
  const customSel = '[data-qa="custom-bump-button"]';
  const frame = makeFrame({ visible: true, enabled: true, text: 'Поднять в поиске' });
  await bumpResume(frame, { dryRun: true, selector: customSel });
  assert.equal(frame._lastSel(), customSel);
});

// Дефолтный selector — RESUME_SELECTORS.updateButton.
test('bumpResume: дефолтный selector → [data-qa="resume-update-button"]', async () => {
  const frame = makeFrame({ visible: false });
  await bumpResume(frame);
  assert.equal(frame._lastSel(), '[data-qa="resume-update-button"]');
});

// isVisible бросает → трактуется как false → not_found.
test('bumpResume: isVisible бросает → not_found, не падает наружу', async () => {
  const frame = {
    locator() {
      return {
        isVisible: async () => { throw new Error('no dom'); },
        isEnabled: async () => true,
        innerText: async () => 'Поднять в поиске',
        click: async () => {},
      };
    },
    _clickCount: () => 0,
    _lastSel: () => null,
  };
  const result = await bumpResume(frame, { dryRun: false });
  assert.equal(result.bumped, false);
  assert.equal(result.reason, 'not_found');
});
