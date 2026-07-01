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
import { parseThreadList, parseThreadMessages, mergeThreadsById } from './lib/chatParse.js';
import { decideReply } from './lib/replyPolicy.js';
import { lastEmployerMessage } from './lib/chatParse.js';
import { generateReply } from './lib/replyGenerate.js';
import { sendReply, createProcessedTracker } from './lib/replySend.js';
import { runIsolated } from './lib/isolate.js';
import { randomDelayMs } from './lib/pacing.js';
import { withTimeout } from './lib/withTimeout.js';
import { detectCollectProblem, COLLECT_LOGGED_OUT } from './lib/collectState.js';

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
 * Включает фильтр «только непрочитанные» в списке тредов chatik (best-effort).
 *
 * Резолвит M-баг: список тредов ВИРТУАЛИЗИРОВАН (в DOM единовременно ~14 строк), а
 * непрочитанные бейджи у верхних (недавно прочитанных) тредов часто отсутствуют — простое
 * чтение layout один раз видит только первые тени тредов и может решить «нет непрочитанных»
 * при 100+ реальных. Чекбокс-фильтр — самый надёжный источник истины: если он включён,
 * КАЖДАЯ отрендеренная ячейка гарантированно непрочитана (проверено на живом DOM).
 *
 * @param {import('playwright').Frame | import('playwright').Page} frame
 * @returns {Promise<boolean>} true — чекбокс найден и нажат; false — не найден/не видим (fallback на бейджи).
 */
export async function enableOnlyUnreadFilter(frame) {
  const checkbox = frame.locator(CHAT_SELECTORS.threadList.onlyUnreadCheckbox);
  const visible = await checkbox.isVisible().catch(() => false);
  if (!visible) return false;

  const clicked = await checkbox
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!clicked) return false;

  await frame.waitForTimeout(600).catch(() => {});
  return true;
}

/**
 * Собирает ПОЛНЫЙ список тредов, прокручивая виртуализированный список chatik и сливая
 * снимки через mergeThreadsById. Без скролла listThreads видит только ~14 верхних строк
 * (виртуализация DOM) — при 100+ тредах это давало ложное «нет новых сообщений».
 *
 * Резилентность: каждый шаг (innerHTML, evaluate-скролл, waitForTimeout) обёрнут в .catch,
 * никогда не бросает — в худшем случае вернёт то, что успело накопиться.
 *
 * @param {import('playwright').Frame | import('playwright').Page} frame
 * @param {import('playwright').Page} page
 * @param {{ maxRounds?: number, settleMs?: number }} [opts]
 * @returns {Promise<Array<{ chatId: string, href: string, unread: boolean, unreadCount: number }>>}
 */
export async function collectThreadsScrolling(frame, page, opts = {}) {
  const { maxRounds = 80, settleMs = 700 } = opts;

  let acc = [];
  let stagnant = 0;
  let round = 0;

  for (; round < maxRounds; round += 1) {
    const html = await frame
      .locator(CHAT_SELECTORS.threadList.layout)
      .innerHTML()
      .catch(() => '');
    const parsed = parseThreadList(html);
    const before = acc.length;
    acc = mergeThreadsById(acc, parsed);
    const grew = acc.length > before;

    // Прокручиваем виртуализированный контейнер списка до конца (ближайший скроллящийся
    // предок ячейки треда) — верифицированная на живом DOM стратегия.
    const scrolled = await frame
      .evaluate(() => {
        const cell = document.querySelector('[data-qa^="chatik-open-chat-"]');
        let el = cell;
        while (el && el !== document.body) {
          const oy = getComputedStyle(el).overflowY;
          if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 20) {
            const prev = el.scrollTop; el.scrollTop = el.scrollHeight; return el.scrollTop !== prev;
          }
          el = el.parentElement;
        }
        return false;
      })
      .catch(() => false);

    await page.waitForTimeout(settleMs).catch(() => {});

    if (grew) {
      stagnant = 0;
    } else {
      stagnant += 1;
      if (!scrolled) break; // список полностью загружен / не скроллится — дальше нечего ждать
      if (stagnant >= 2) break; // два подряд раунда без роста — считаем список исчерпанным
    }
  }

  if (round >= maxRounds) {
    console.log('[messages] Достигнут лимит прокрутки списка тредов (maxRounds) — список мог быть усечён');
  }

  return acc;
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
    // Чат не найден = либо штатно пусто, либо сессия разлогинена (goto /chat редиректит на
    // вход). Best-effort проверяем текст+URL (M19.2): при разлогине панель должна показать
    // «Сессия разлогинена», а не безобидное «Чат не найден». Текст страницы — untrusted:
    // только .test()-матчится внутри detectCollectProblem, наружу/в лог не эхо-ится.
    const pageText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    let pageUrl = '';
    try { pageUrl = page.url(); } catch { pageUrl = ''; }
    const loggedOut = detectCollectProblem({ text: pageText, url: pageUrl }) === COLLECT_LOGGED_OUT;
    console.log(
      loggedOut
        ? '[messages] Сессия разлогинена — нужен вход, обработка сообщений пропущена'
        : '[messages] Чат не найден, пропускаем обработку сообщений',
    );
    // chatFound=false → «Чат не найден» (M18.5); loggedOut=true → вызывающий (daemon)
    // поднимет heartbeat state='logged_out' вместо безобидного «Готово».
    return { processed: 0, replied: 0, skipped: 0, manual: 0, errors: 0, chatFound: false, loggedOut };
  }

  // 2. Список тредов. По умолчанию — только непрочитанные: включаем чекбокс-фильтр
  //    «только непрочитанные» (если он есть) и прокручиваем виртуализированный список —
  //    без скролла listThreads видел бы только ~14 верхних строк DOM и мог решить
  //    «нет непрочитанных» при 100+ реальных. С includeRead — все треды (чтобы поймать
  //    employer-last в уже «прочитанных»); decideReply отсеет те, где последнее сообщение
  //    наше или системное.
  const filterEnabled = includeRead ? false : await enableOnlyUnreadFilter(frame);
  const threads = await collectThreadsScrolling(frame, page);
  const targets = includeRead
    ? threads
    : filterEnabled
      // Чекбокс-фильтр гарантирует: каждая отрендеренная ячейка непрочитана (бейджи могут
      // отставать от рендера, поэтому доп. фильтрацию по unread здесь не делаем).
      ? threads
      // Fallback: чекбокса нет на странице — используем старое поведение по бейджам.
      : threads.filter((t) => t.unread === true);
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
