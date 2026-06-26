// Примитив безопасной отправки сообщения в чат hh.ru (chatik).
// M4.6 — safe-gated отправка с идемпотентностью через in-memory Set.
//
// Дефолт: требует явного подтверждения (--reply-manual) или флага --reply-auto.
// В dry-run НИКОГДА не трогает DOM.

import { CHAT_SELECTORS } from './selectors.js';

// ---------------------------------------------------------------------------
// createProcessedTracker — in-memory трекер обработанных тредов за сессию.
// Ключи приводятся к строке, чтобы числовой и строковый chatId были эквивалентны.
// ---------------------------------------------------------------------------

/**
 * Создаёт in-memory трекер обработанных тредов.
 * Предотвращает дублирование ответов в рамках одной сессии.
 *
 * @returns {{ has(chatId: string|number): boolean, add(chatId: string|number): void, size(): number }}
 */
export function createProcessedTracker() {
  const _set = new Set();

  return {
    /** Проверяет, был ли тред уже обработан в текущей сессии. */
    has(chatId) {
      return _set.has(String(chatId));
    },

    /** Отмечает тред как обработанный. */
    add(chatId) {
      _set.add(String(chatId));
    },

    /** Возвращает количество обработанных тредов. */
    size() {
      return _set.size;
    },
  };
}

// ---------------------------------------------------------------------------
// decideSend — чистая функция-гейт.
// Никакого DOM. Никаких сайд-эффектов. Ранний возврат по приоритету.
// ---------------------------------------------------------------------------

/**
 * Определяет, можно ли отправить сообщение в данный момент.
 * Чистая функция — без сайд-эффектов, без DOM.
 *
 * Приоритет проверок (ранний возврат):
 * 1. alreadyProcessed === true  → { send:false, reason:'already_processed' }
 * 2. dryRun === true            → { send:false, reason:'dry_run' }
 * 3. replyAuto !== true && confirmed !== true → { send:false, reason:'not_confirmed' }
 * 4. иначе                     → { send:true, reason:'auto'|'confirmed' }
 *
 * @param {{ dryRun?: boolean, replyAuto?: boolean, confirmed?: boolean, alreadyProcessed?: boolean }} [opts]
 * @returns {{ send: boolean, reason: string }}
 */
export function decideSend({ dryRun, replyAuto, confirmed, alreadyProcessed } = {}) {
  // 1. Идемпотентность — тред уже обработан в этой сессии.
  if (alreadyProcessed === true) {
    return { send: false, reason: 'already_processed' };
  }

  // 2. Dry-run — никогда не отправляем.
  if (dryRun === true) {
    return { send: false, reason: 'dry_run' };
  }

  // 3. Дефолт безопасный — требуется явное подтверждение.
  if (replyAuto !== true && confirmed !== true) {
    return { send: false, reason: 'not_confirmed' };
  }

  // 4. Отправка разрешена.
  return { send: true, reason: replyAuto === true ? 'auto' : 'confirmed' };
}

// ---------------------------------------------------------------------------
// sendReply — resilient-обёртка отправки.
// Никогда не бросает наружу. Все DOM-вызовы защищены try/catch.
// ---------------------------------------------------------------------------

/**
 * Отправляет сообщение в поле composer открытого чата.
 * Не трогает DOM, если гейт (decideSend) не пропустил.
 *
 * @param {import('playwright').Frame | import('playwright').Page} frame
 *   Playwright Frame или Page с открытым чатом.
 * @param {string} text - Текст сообщения.
 * @param {{
 *   dryRun?: boolean,
 *   replyAuto?: boolean,
 *   confirmed?: boolean,
 *   alreadyProcessed?: boolean,
 *   selectors?: { newMessageText: string, sendButton: string },
 * }} [opts]
 * @returns {Promise<{ sent: boolean, reason: string }>}
 */
export async function sendReply(frame, text, opts = {}) {
  // 1. Валидация текста — до гейта, до DOM.
  if (typeof text !== 'string' || text.trim() === '') {
    return { sent: false, reason: 'empty_text' };
  }

  // 2. Гейт безопасности — не трогаем DOM, если не пропустил.
  const decision = decideSend(opts);
  if (!decision.send) {
    return { sent: false, reason: decision.reason };
  }

  // 3. DOM-взаимодействие — всё в try/catch, наружу не бросаем.
  try {
    const sel = opts.selectors ?? CHAT_SELECTORS.composer;

    // Проверяем доступность textarea.
    const textarea = frame.locator(sel.newMessageText);
    const editable = await textarea.isEditable().catch(() => false);
    if (!editable) {
      return { sent: false, reason: 'composer_not_editable' };
    }

    await textarea.fill(text);

    // Проверяем доступность кнопки «Отправить».
    const button = frame.locator(sel.sendButton);
    const enabled = await button.isEnabled().catch(() => true);
    if (!enabled) {
      return { sent: false, reason: 'send_button_disabled' };
    }

    await button.click();

    return { sent: true, reason: decision.reason };
  } catch {
    console.log('[replySend] Ошибка при отправке сообщения в чат');
    return { sent: false, reason: 'send_failed' };
  }
}
