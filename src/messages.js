/**
 * src/messages.js — модуль авто-ответов на сообщения hh.ru (chatik).
 *
 * Архитектура доступа к чату (актуально на 2026-06, проверено на живом DOM):
 *   - Основной путь: chatik рендерится ИНЛАЙН на hh.ru/chat (data-qa="chatik-layout"
 *     в DOM самой страницы, без cross-origin iframe). processUnread переходит на CHAT_URL,
 *     getChatFrame возвращает сам page.
 *   - Legacy-fallback: старая iframe-интеграция (CHATIK_IFRAME_SELECTOR / chatik.hh.ru
 *     во фрейме) — оставлена в getChatFrame на случай возврата старого UI.
 *
 * Безопасность:
 *   - Входящие письма работодателей — untrusted-ввод (вектор prompt-injection).
 *     Гардрейлы DeepSeek (honesty, NO_ANSWER, candidate-voice) применяются в replyGenerate.js.
 *   - dryRun по умолчанию true — без явного отключения ничего не отправляется.
 *   - tracker.add вызывается ТОЛЬКО после успешной отправки (handshake).
 *   - Текст письма работодателя не пишется в лог (privacy).
 */

import { fileURLToPath } from 'node:url';
import { CHAT_SELECTORS, CHATIK_IFRAME_SELECTOR, CHATIK_URL_PATTERN } from './lib/selectors.js';
import { parseThreadList, parseThreadMessages } from './lib/chatParse.js';
import { decideReply } from './lib/replyPolicy.js';
import { lastEmployerMessage } from './lib/chatParse.js';
import { generateReply } from './lib/replyGenerate.js';
import { sendReply, createProcessedTracker } from './lib/replySend.js';
import { runIsolated } from './lib/isolate.js';
import { randomDelayMs } from './lib/pacing.js';
import { withTimeout } from './lib/withTimeout.js';

/** Страница чата кандидата. Современный hh.ru рендерит chatik ИНЛАЙН здесь (не в iframe). */
export const CHAT_URL = 'https://hh.ru/chat';

/**
 * Таймаут на открытие chatik-фрейма (M16.4). getChatFrame делает быстрые isVisible-проверки,
 * но если страница/фрейм подвисли (нет ответа hh.ru), без гарда processUnread зависнет навсегда.
 * При превышении → frame=null → штатная ветка «Чат не найден» (graceful-стоп шага).
 */
const GET_CHAT_FRAME_TIMEOUT_MS = 20000;

/**
 * Возвращает Playwright frame/page, в котором живёт chatik.
 *
 * На текущем hh.ru chatik рендерится ИНЛАЙН прямо на /chat (data-qa="chatik-layout"
 * в DOM самой страницы, без cross-origin iframe) — это основной путь. Старая
 * iframe-интеграция (chatik.hh.ru во фрейме) оставлена как legacy-fallback.
 * Возвращает null при любой ошибке (resilient — не бросает).
 *
 * Предполагается, что вызывающий уже перешёл на CHAT_URL (это делает processUnread).
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<import('playwright').Frame | import('playwright').Page | null>}
 */
export async function getChatFrame(page) {
  // Основной путь: chatik инлайн на странице (data-qa="chatik-layout" прямо в DOM).
  const inlineVisible = await page
    .locator(CHAT_SELECTORS.threadList.layout)
    .first()
    .isVisible()
    .catch(() => false);
  if (inlineVisible) return page;

  // Legacy: iframe-интеграция chatik на страницах hh.ru.
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
 * Оркестрирует обход непрочитанных тредов и генерацию/отправку ответов.
 *
 * Безопасность:
 *   - dryRun дефолт true — без явного opts.dryRun=false ничего не отправляется.
 *   - replyAuto дефолт false — без явного флага требуется подтверждение через confirmFn.
 *   - tracker.add НА ОТПРАВКУ вызывается ТОЛЬКО после sendResult.sent===true (handshake:
 *     dry-run/not-confirmed НЕ трекаются, чтобы поздний реальный прогон мог отправить).
 *     skip- и manual-треды трекаются отдельно — чтобы за сессию не пере-открывать их
 *     каждую итерацию поллинга (manual — ещё и чтобы не тратить токены DeepSeek повторно).
 *   - Текст письма работодателя не пишется в лог.
 *
 * Счётчики: processed = треды, реально открытые и осмотренные в этом прогоне;
 *   skipped = не обработанные (идемпотентность ИЛИ policy-skip); manual = на ручную;
 *   replied = реально отправленные ответы; errors = треды с необработанным исключением.
 *
 * @param {import('playwright').Page} page
 * @param {{
 *   account?: string,
 *   dryRun?: boolean,
 *   replyAuto?: boolean,
 *   deepSeekContext?: {
 *     apiKey: string,
 *     apiUrl?: string,
 *     model?: string,
 *     resumeProfile?: string,
 *     salary?: string,
 *   },
 *   tracker?: { has(id: string|number): boolean, add(id: string|number): void },
 *   confirmFn?: (preview: string) => Promise<boolean>,
 * }} opts
 * @returns {Promise<{ processed: number, replied: number, skipped: number, manual: number, errors: number, chatFound: boolean }>}
 */
export async function processUnread(page, opts = {}) {
  const {
    account = '',
    dryRun = true,        // ДЕФОЛТ SAFE: ничего не отправляем без явного false
    replyAuto = false,    // ДЕФОЛТ SAFE: без явного флага требуется подтверждение
    deepSeekContext = {},
    confirmFn,
    // includeRead: обрабатывать ВСЕ треды, а не только непрочитанные. Нужно, чтобы
    // отвечать на треды, где работодатель написал последним, но тред уже «прочитан».
    // Идемпотентность держит decideReply (applicant-last → skip) + tracker.
    includeRead = false,
    // Анти-бот-пейсинг: рандомная пауза после реально отправленного ответа (сек→мс).
    minDelayMs = 2000,
    maxDelayMs = 7000,
  } = opts;

  // Используем переданный трекер или создаём локальный для этой сессии.
  const tracker = opts.tracker ?? createProcessedTracker();

  // 0. Переходим на страницу чата (chatik рендерится инлайн на hh.ru/chat).
  //    best-effort: ошибка навигации не бросается — getChatFrame вернёт null ниже.
  await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(2000).catch(() => {});

  // 1. Получаем frame чата (под таймаут-гардом — фрейм не должен висеть вечно, M16.4).
  const frame = await withTimeout(getChatFrame(page), GET_CHAT_FRAME_TIMEOUT_MS, null);
  if (!frame) {
    console.log('[messages] Чат не найден, пропускаем обработку сообщений');
    // chatFound=false → панель покажет понятное «Чат не найден» (M18.5), не «падение».
    return { processed: 0, replied: 0, skipped: 0, manual: 0, errors: 0, chatFound: false };
  }

  // 2. Список тредов. По умолчанию — только непрочитанные (дёшево). С includeRead —
  //    все треды (чтобы поймать employer-last в уже «прочитанных»); decideReply отсеет
  //    те, где последнее сообщение наше или системное.
  const threads = await listThreads(frame);
  const targets = includeRead ? threads : threads.filter((t) => t.unread === true);
  console.log(
    `[messages] ${account ? `[${account}] ` : ''}` +
    (includeRead
      ? `Тредов к осмотру (включая прочитанные): ${targets.length} из ${threads.length}`
      : `Найдено непрочитанных тредов: ${targets.length}`)
  );

  let processed = 0;
  let replied = 0;
  let skipped = 0;
  let manual = 0;
  let errors = 0;

  // 3. Обходим выбранные треды через runIsolated — один сбой не роняет остальные.
  const threadResults = await runIsolated(targets, async (thread) => {
    const { chatId } = thread;

    // a. Идемпотентность: уже обработан в этой сессии.
    if (tracker.has(chatId)) {
      skipped++;
      return;
    }

    // b. Открываем тред кликом по ячейке (resilient: игнорируем ошибку клика).
    await frame
      .locator(`[data-qa="chatik-open-chat-${chatId}"]`)
      .click()
      .catch(() => {});
    // Ждём прогрузки чата — consistent со стилем других DOM-ожиданий в проекте.
    await page.waitForTimeout(800).catch(() => {});

    // Тред реально открыт и осматривается → засчитываем как processed (единообразно).
    processed++;

    // c. Читаем сообщения открытого треда.
    const messages = await readThread(frame);

    // d. Политика ответа.
    const decision = decideReply(messages);

    if (decision.action === 'skip') {
      skipped++;
      tracker.add(chatId); // Помечаем чтобы не пере-сканировать в этой сессии.
      return;
    }

    if (decision.action === 'manual') {
      manual++;
      // Трекаем, чтобы за сессию не пере-открывать этот тред каждую итерацию поллинга.
      tracker.add(chatId);
      // Не логируем текст письма работодателя (privacy).
      console.log(`[messages] Тред ${chatId}: нужна ручная обработка (${decision.reason})`);
      return;
    }

    // e. action === 'needs_model' → генерируем ответ через DeepSeek.
    if (decision.action === 'needs_model') {
      // Берём текст последнего сообщения работодателя (untrusted-вход; в лог не пишем).
      const employerText = lastEmployerMessage(messages);

      // Название вакансии из шапки чата — best-effort, не критично если не нашли.
      const vacancyTitle = await frame
        .locator(CHAT_SELECTORS.openChat.vacancyLinkText)
        .innerText()
        .catch(() => '');

      const gen = await generateReply({
        employerMessage: employerText,
        vacancyTitle,
        resumeProfile: deepSeekContext.resumeProfile,
        salary: deepSeekContext.salary,
        preferences: deepSeekContext.preferences,
        apiKey: deepSeekContext.apiKey,
        apiUrl: deepSeekContext.apiUrl,
        model: deepSeekContext.model,
      });

      // Если модель не смогла дать ответ — отправляем на ручную обработку.
      if (gen.status !== 'ok') {
        manual++;
        // Трекаем: иначе каждый поллинг будет заново тратить токены DeepSeek на тот же тред.
        tracker.add(chatId);
        console.log(`[messages] Тред ${chatId}: нет авто-ответа (${gen.status}${gen.reason ? ': ' + gen.reason : ''}), нужна ручная обработка`);
        return;
      }

      // Подтверждение оператора. При replyAuto=true сам флаг авторизует отправку в
      // sendReply (decideSend), confirmed не нужен. Иначе спрашиваем confirmFn.
      let confirmed = false;
      if (!replyAuto && typeof confirmFn === 'function') {
        // Показываем превью оператору (gen.text — наш сгенерированный ответ, не PII работодателя).
        confirmed = await confirmFn(gen.text).catch(() => false);
      }
      // Если нет ни replyAuto, ни confirmFn → confirmed=false → sendReply вернёт not_confirmed.

      const sendResult = await sendReply(frame, gen.text, {
        dryRun,
        replyAuto,
        confirmed,
        alreadyProcessed: false,
      });

      if (sendResult.sent) {
        replied++;
        // HANDSHAKE: tracker.add ТОЛЬКО после успешной отправки (dry-run/not-confirmed
        // НЕ трекаются — поздний реальный прогон сможет отправить).
        tracker.add(chatId);
        // Анти-бот: человеческая пауза после реального ответа (sent=true ⇒ не dry-run).
        const waitMs = randomDelayMs(minDelayMs, maxDelayMs);
        if (waitMs > 0) await page.waitForTimeout(waitMs).catch(() => {});
      } else {
        console.log(`[messages] Тред ${chatId}: не отправлено (${sendResult.reason})`);
      }

      return;
    }
  });

  // Считаем ошибки из runIsolated (треды, у которых выбросило необработанное исключение).
  errors = threadResults.failed;

  // chatFound=true → исход различает «нет новых» (processed=0) и «обработано» (M18.5).
  return { processed, replied, skipped, manual, errors, chatFound: true };
}

// Точка входа (guard — не запускается при импорте, только при прямом вызове).
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('src/messages.js: авто-ответы на сообщения hh.ru. Используйте processUnread(page, opts) программно.');
  console.log('Для запуска поллинга передайте page из launchBrowser и вызовите processUnread с opts.dryRun=false явно.');
  process.exit(0);
}
