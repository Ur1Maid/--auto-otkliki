import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createProcessedTracker,
  decideSend,
  sendReply,
} from '../src/lib/replySend.js';

// ---------------------------------------------------------------------------
// Вспомогательная фабрика мок-frame для тестов sendReply.
// Возвращает шпион, фиксирующий все вызовы locator/fill/click/isEditable/isEnabled.
// ---------------------------------------------------------------------------

/**
 * Создаёт мок Playwright Frame/Page.
 * @param {{
 *   editable?: boolean,
 *   enabled?: boolean,
 *   clickThrows?: boolean,
 * }} [config]
 */
function makeMockFrame({ editable = true, enabled = true, clickThrows = false } = {}) {
  const calls = {
    locatorArgs: [],   // аргументы каждого вызова frame.locator(...)
    fill: [],          // аргументы каждого вызова textarea.fill(text)
    click: 0,          // количество вызовов button.click()
    isEditable: 0,
    isEnabled: 0,
  };

  function makeLocator(selector) {
    return {
      isEditable() {
        calls.isEditable += 1;
        return Promise.resolve(editable);
      },
      fill(text) {
        calls.fill.push(text);
        return Promise.resolve();
      },
      isEnabled() {
        calls.isEnabled += 1;
        return Promise.resolve(enabled);
      },
      click() {
        calls.click += 1;
        if (clickThrows) throw new Error('клик провалился');
        return Promise.resolve();
      },
    };
  }

  const frame = {
    locator(selector) {
      calls.locatorArgs.push(selector);
      return makeLocator(selector);
    },
  };

  return { frame, calls };
}

// ---------------------------------------------------------------------------
// createProcessedTracker
// ---------------------------------------------------------------------------

test('createProcessedTracker: has возвращает false для нового chatId', () => {
  const tracker = createProcessedTracker();
  assert.equal(tracker.has('chat-1'), false);
});

test('createProcessedTracker: add + has возвращает true', () => {
  const tracker = createProcessedTracker();
  tracker.add('chat-1');
  assert.equal(tracker.has('chat-1'), true);
});

test('createProcessedTracker: size отражает количество уникальных элементов', () => {
  const tracker = createProcessedTracker();
  assert.equal(tracker.size(), 0);
  tracker.add('a');
  assert.equal(tracker.size(), 1);
  tracker.add('b');
  assert.equal(tracker.size(), 2);
});

test('createProcessedTracker: повторный add не увеличивает size (дедупликация)', () => {
  const tracker = createProcessedTracker();
  tracker.add('x');
  tracker.add('x');
  assert.equal(tracker.size(), 1);
});

test('createProcessedTracker: числовой и строковый id эквивалентны', () => {
  const tracker = createProcessedTracker();
  tracker.add(5);
  assert.equal(tracker.has('5'), true, 'add(5) → has("5") должен быть true');
  assert.equal(tracker.has(5), true, 'add(5) → has(5) должен быть true');
});

test('createProcessedTracker: add строки, has числа', () => {
  const tracker = createProcessedTracker();
  tracker.add('42');
  assert.equal(tracker.has(42), true);
});

test('createProcessedTracker: разные id не пересекаются', () => {
  const tracker = createProcessedTracker();
  tracker.add('1');
  assert.equal(tracker.has('2'), false);
});

// ---------------------------------------------------------------------------
// decideSend — все ветки
// ---------------------------------------------------------------------------

test('decideSend: alreadyProcessed:true → send:false, reason:"already_processed"', () => {
  const r = decideSend({ alreadyProcessed: true });
  assert.equal(r.send, false);
  assert.equal(r.reason, 'already_processed');
});

test('decideSend: dryRun:true → send:false, reason:"dry_run"', () => {
  const r = decideSend({ dryRun: true });
  assert.equal(r.send, false);
  assert.equal(r.reason, 'dry_run');
});

test('decideSend: дефолт (без параметров) → send:false, reason:"not_confirmed"', () => {
  const r = decideSend();
  assert.equal(r.send, false);
  assert.equal(r.reason, 'not_confirmed');
});

test('decideSend: replyAuto:false, confirmed:false → send:false, reason:"not_confirmed"', () => {
  const r = decideSend({ replyAuto: false, confirmed: false });
  assert.equal(r.send, false);
  assert.equal(r.reason, 'not_confirmed');
});

test('decideSend: replyAuto:true → send:true, reason:"auto"', () => {
  const r = decideSend({ replyAuto: true });
  assert.equal(r.send, true);
  assert.equal(r.reason, 'auto');
});

test('decideSend: confirmed:true → send:true, reason:"confirmed"', () => {
  const r = decideSend({ confirmed: true });
  assert.equal(r.send, true);
  assert.equal(r.reason, 'confirmed');
});

test('decideSend: приоритет already_processed над dry_run', () => {
  const r = decideSend({ alreadyProcessed: true, dryRun: true });
  assert.equal(r.reason, 'already_processed');
});

test('decideSend: приоритет dry_run над not_confirmed', () => {
  // Без replyAuto и confirmed, dryRun:true → dry_run, не not_confirmed
  const r = decideSend({ dryRun: true, replyAuto: false, confirmed: false });
  assert.equal(r.reason, 'dry_run');
});

test('decideSend: приоритет already_processed над confirmed', () => {
  const r = decideSend({ alreadyProcessed: true, confirmed: true });
  assert.equal(r.send, false);
  assert.equal(r.reason, 'already_processed');
});

// ---------------------------------------------------------------------------
// sendReply — safety-критичные тесты: dry-run и not_confirmed НЕ трогают DOM
// ---------------------------------------------------------------------------

test('sendReply dry-run: НИ fill, НИ click НЕ вызваны; reason:"dry_run", sent:false', async () => {
  const { frame, calls } = makeMockFrame();
  const result = await sendReply(frame, 'Привет', { dryRun: true });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'dry_run');
  assert.equal(calls.fill.length, 0, 'fill НЕ должен быть вызван в dry-run');
  assert.equal(calls.click, 0, 'click НЕ должен быть вызван в dry-run');
});

test('sendReply not_confirmed (дефолт): НИ fill/click; reason:"not_confirmed"', async () => {
  const { frame, calls } = makeMockFrame();
  // replyAuto и confirmed не переданы — дефолт требует подтверждения
  const result = await sendReply(frame, 'Привет');
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'not_confirmed');
  assert.equal(calls.fill.length, 0, 'fill НЕ должен быть вызван без подтверждения');
  assert.equal(calls.click, 0, 'click НЕ должен быть вызван без подтверждения');
});

test('sendReply already_processed: НИ fill/click; reason:"already_processed"', async () => {
  const { frame, calls } = makeMockFrame();
  const result = await sendReply(frame, 'Привет', { alreadyProcessed: true });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'already_processed');
  assert.equal(calls.fill.length, 0);
  assert.equal(calls.click, 0);
});

// ---------------------------------------------------------------------------
// sendReply — успешная отправка
// ---------------------------------------------------------------------------

test('sendReply confirmed:true: fill вызван с текстом, click вызван; sent:true, reason:"confirmed"', async () => {
  const { frame, calls } = makeMockFrame();
  const result = await sendReply(frame, 'Готов к собеседованию', { confirmed: true });
  assert.equal(result.sent, true);
  assert.equal(result.reason, 'confirmed');
  assert.equal(calls.fill.length, 1);
  assert.equal(calls.fill[0], 'Готов к собеседованию');
  assert.equal(calls.click, 1);
});

test('sendReply replyAuto:true: fill+click вызваны; sent:true, reason:"auto"', async () => {
  const { frame, calls } = makeMockFrame();
  const result = await sendReply(frame, 'Спасибо!', { replyAuto: true });
  assert.equal(result.sent, true);
  assert.equal(result.reason, 'auto');
  assert.equal(calls.fill.length, 1);
  assert.equal(calls.fill[0], 'Спасибо!');
  assert.equal(calls.click, 1);
});

// ---------------------------------------------------------------------------
// sendReply — валидация текста (пустой/не строка)
// ---------------------------------------------------------------------------

test('sendReply пустая строка "": НИ fill/click; reason:"empty_text"', async () => {
  const { frame, calls } = makeMockFrame();
  const result = await sendReply(frame, '', { confirmed: true });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'empty_text');
  assert.equal(calls.fill.length, 0);
  assert.equal(calls.click, 0);
});

test('sendReply строка из пробелов "  ": НИ fill/click; reason:"empty_text"', async () => {
  const { frame, calls } = makeMockFrame();
  const result = await sendReply(frame, '  ', { confirmed: true });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'empty_text');
  assert.equal(calls.fill.length, 0);
  assert.equal(calls.click, 0);
});

test('sendReply text не строка (null): НИ fill/click; reason:"empty_text"', async () => {
  const { frame, calls } = makeMockFrame();
  const result = await sendReply(frame, null, { confirmed: true });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'empty_text');
  assert.equal(calls.fill.length, 0);
  assert.equal(calls.click, 0);
});

test('sendReply text не строка (число): reason:"empty_text"', async () => {
  const { frame, calls } = makeMockFrame();
  const result = await sendReply(frame, 42, { confirmed: true });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'empty_text');
  assert.equal(calls.fill.length, 0);
  assert.equal(calls.click, 0);
});

// ---------------------------------------------------------------------------
// sendReply — composer недоступен
// ---------------------------------------------------------------------------

test('sendReply composer не editable: fill и click НЕ вызваны; reason:"composer_not_editable"', async () => {
  const { frame, calls } = makeMockFrame({ editable: false });
  const result = await sendReply(frame, 'Привет', { confirmed: true });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'composer_not_editable');
  assert.equal(calls.fill.length, 0, 'fill НЕ должен быть вызван при не-editable textarea');
  assert.equal(calls.click, 0, 'click НЕ должен быть вызван при не-editable textarea');
});

test('sendReply кнопка disabled: fill вызван, click НЕ вызван; reason:"send_button_disabled"', async () => {
  const { frame, calls } = makeMockFrame({ enabled: false });
  const result = await sendReply(frame, 'Текст', { confirmed: true });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'send_button_disabled');
  assert.equal(calls.fill.length, 1, 'fill должен быть вызван до проверки кнопки');
  assert.equal(calls.click, 0, 'click НЕ должен быть вызван, если кнопка disabled');
});

// ---------------------------------------------------------------------------
// sendReply — обработка исключений
// ---------------------------------------------------------------------------

test('sendReply click бросает: reason:"send_failed", наружу не бросает', async () => {
  const { frame } = makeMockFrame({ clickThrows: true });
  let result;
  await assert.doesNotReject(async () => {
    result = await sendReply(frame, 'Текст', { confirmed: true });
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'send_failed');
});

// ---------------------------------------------------------------------------
// sendReply — кастомные selectors
// ---------------------------------------------------------------------------

test('sendReply кастомные selectors уважаются: frame.locator вызван с переданными селекторами', async () => {
  const { frame, calls } = makeMockFrame();
  const customSelectors = {
    newMessageText: '[data-qa="custom-textarea"]',
    sendButton: '[data-qa="custom-send"]',
  };
  await sendReply(frame, 'Привет', { confirmed: true, selectors: customSelectors });
  assert.ok(
    calls.locatorArgs.includes('[data-qa="custom-textarea"]'),
    'locator должен быть вызван с кастомным селектором textarea',
  );
  assert.ok(
    calls.locatorArgs.includes('[data-qa="custom-send"]'),
    'locator должен быть вызван с кастомным селектором кнопки',
  );
});

test('sendReply без opts.selectors: используются CHAT_SELECTORS.composer', async () => {
  const { frame, calls } = makeMockFrame();
  await sendReply(frame, 'Привет', { confirmed: true });
  assert.ok(
    calls.locatorArgs.some((s) => s.includes('chatik-new-message-text')),
    'должен использоваться дефолтный селектор textarea из CHAT_SELECTORS.composer',
  );
  assert.ok(
    calls.locatorArgs.some((s) => s.includes('chatik-do-send-message')),
    'должен использоваться дефолтный селектор кнопки из CHAT_SELECTORS.composer',
  );
});
