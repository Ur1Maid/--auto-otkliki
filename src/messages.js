/**
 * src/messages.js — скелет модуля авто-ответов на сообщения hh.ru (chatik).
 *
 * Архитектура доступа к чату:
 *   - Чат живёт в cross-origin iframe (CHATIK_IFRAME_SELECTOR) на страницах hh.ru,
 *     либо как отдельная страница chatik.hh.ru.
 *   - В Playwright: сначала пробуем frameLocator(CHATIK_IFRAME_SELECTOR),
 *     если не найден — page.frame({ url: CHATIK_URL_PATTERN }), либо прямой переход /chat/<id>.
 *
 * Безопасность:
 *   - Входящие письма работодателей — untrusted-ввод (вектор prompt-injection).
 *     Гардрейлы DeepSeek (honesty, NO_ANSWER, candidate-voice) применяются в M4.3/M4.5.
 *   - Reply по умолчанию требует подтверждения от оператора (реализуется в M4.6).
 *
 * Задачи по плану:
 *   M4.2 — навигация и обход тредов
 *   M4.3 — извлечение и анализ сообщений (parser открытого чата)
 *   M4.4 — reply-policy (когда отвечать, когда пропускать)
 *   M4.5 — генерация ответа через DeepSeek с гардрейлами
 *   M4.6 — подтверждение перед отправкой (human-in-the-loop)
 *   M4.7 — отправка сообщения через composer
 */

import { fileURLToPath } from 'node:url';
import { CHAT_SELECTORS, CHATIK_IFRAME_SELECTOR, CHATIK_URL_PATTERN } from './lib/selectors.js';
import { parseThreadList, parseThreadMessages } from './lib/chatParse.js';

/**
 * Возвращает Playwright-frame чата.
 * Сначала пробует iframe-интеграцию на hh.ru; если не найден — ищет frame по URL chatik.hh.ru.
 * Возвращает null при любой ошибке (resilient — не бросает).
 *
 * TODO (M4.2): добавить fallback на прямой переход page.goto('/chats') и ожидание iframe.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<import('playwright').Frame | null>}
 */
export async function getChatFrame(page) {
  // Пробуем iframe-интеграцию (основной путь на страницах hh.ru)
  const frameLocator = page.frameLocator(CHATIK_IFRAME_SELECTOR);
  const hasIframe = await frameLocator
    .locator('body')
    .isVisible()
    .catch(() => false);
  if (hasIframe) {
    return page.frame({ url: CHATIK_URL_PATTERN }) ?? null;
  }

  // Fallback: отдельная вкладка/страница chatik.hh.ru
  const directFrame = page.frames().find((f) => CHATIK_URL_PATTERN.test(f.url()));
  return directFrame ?? null;
}

/**
 * Получает HTML списка тредов из frame чата и парсит его в массив объектов.
 *
 * @param {import('playwright').Frame | import('playwright').Page} frame
 * @returns {Promise<Array<{ chatId: string, href: string, unread: boolean, unreadCount: number }>>}
 */
export async function listThreads(frame) {
  const html = await frame
    .locator(CHAT_SELECTORS.threadList.layout)
    .innerHTML()
    .catch(() => '');
  return parseThreadList(html);
}

/**
 * Получает HTML открытого треда из frame чата и парсит его в массив сообщений.
 *
 * Контейнер: корневой [data-qa="chatik-layout"] (тот же, что у listThreads) — он включает
 * и шапку, и список сообщений открытого треда когда тред открыт. Если нужен более узкий
 * контейнер, оператор может передать другой frame/selector — сейчас берём весь layout.
 *
 * @param {import('playwright').Frame | import('playwright').Page} frame
 * @returns {Promise<Array<{ msgId: string, author: 'employer' | 'applicant', text: string }>>}
 */
export async function readThread(frame) {
  const html = await frame
    .locator(CHAT_SELECTORS.threadList.layout)
    .innerHTML()
    .catch(() => '');
  return parseThreadMessages(html);
}

/**
 * Оркестрирует обход непрочитанных тредов и генерацию ответов.
 *
 * TODO (M4.2–M4.6): реализовать полный цикл:
 *   1. getChatFrame → listThreads → фильтр unread тредов
 *   2. Для каждого треда: открыть, извлечь сообщения (M4.3), применить reply-policy (M4.4)
 *   3. Сгенерировать ответ DeepSeek с гардрейлами (M4.5)
 *   4. Показать оператору preview + подтверждение (M4.6)
 *   5. Отправить через composer (M4.7)
 *
 * @param {import('playwright').Page} page
 * @param {{ account?: string, dryRun?: boolean }} opts
 * @returns {Promise<void>}
 */
export async function processUnread(page, opts = {}) {
  // TODO: реализовать в M4.2–M4.6
  void page;
  void opts;
}

// Точка входа (guard — не запускается при импорте, только при прямом вызове).
// TODO: реализовать parseArgs, launchBrowser и основной цикл в M4.2.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('src/messages.js: авто-ответы на сообщения hh.ru — реализация в M4.2–M4.7.');
  process.exit(0);
}
