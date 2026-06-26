// Реестр CSS/data-qa-селекторов чата hh.ru (chatik.hh.ru).
// Верифицированы по живому DOM. Без Playwright-импортов — только строки-константы.

// === Точка входа в iframe чата ===
/** CSS-селектор iframe, в котором живёт chatik на страницах hh.ru. */
export const CHATIK_IFRAME_SELECTOR = 'iframe.chatik-integration-iframe';

/** Паттерн URL для page.frame() или frame-matching по адресу. */
export const CHATIK_URL_PATTERN = /chatik\.hh\.ru/;

/**
 * Все data-qa-селекторы чата, сгруппированные по контексту.
 * Каждое значение — строка, готовая к оборачиванию в [data-qa="..."].
 */
export const CHAT_SELECTORS = {

  // --- Список тредов (левая панель / главная страница chatik) ---
  threadList: {
    /** Корневой контейнер с тредами. */
    layout: '[data-qa="chatik-layout"]',

    /** Чекбокс фильтра «только непрочитанные». */
    onlyUnreadCheckbox: '[data-qa="chatik-checkbox-only-unread"]',

    /**
     * Ячейка треда. Содержит числовой chatId в data-qa и href="/chat/<id>?hhtmFrom=app".
     * Используй как шаблон: data-qa="chatik-open-chat-<id>".
     * Для выборки всех ячеек подходит CSS-атрибутный префикс:
     *   [data-qa^="chatik-open-chat-"]
     */
    chatCellPrefix: '[data-qa^="chatik-open-chat-"]',

    /** Мета-блок внутри ячейки (название компании, имя и т.п.). */
    chatCellMeta: '[data-qa="chat-cell-meta"]',

    /** Время последнего сообщения внутри ячейки. */
    chatCellTime: '[data-qa="chat-cell-creation-time"]',

    /**
     * Индикатор непрочитанных сообщений. Присутствует ТОЛЬКО у непрочитанных тредов;
     * содержит число N (количество непрочитанных). У прочитанных тредов элемента нет.
     */
    unreadBadge: '[data-qa="chatik-info-badges"]',
  },

  // --- Открытый чат (правая панель) ---
  openChat: {
    /** Ссылка на вакансию в шапке чата. */
    vacancyLink: '[data-qa="chatik-header-vacancy-link"]',

    /** Текст ссылки на вакансию. */
    vacancyLinkText: '[data-qa="chatik-header-vacancy-link-text"]',

    /**
     * Контейнер сообщения. Содержит числовой msgId в data-qa.
     * Шаблон: data-qa="chatik-chat-message-<msgId>".
     */
    messageBubblePrefix: '[data-qa^="chatik-chat-message-"]',

    /**
     * Текстовый контейнер конкретного сообщения.
     * Шаблон: data-qa="chatik-chat-message-<msgId>-text".
     */
    messageTextPrefix: '[data-qa^="chatik-chat-message-"][data-qa$="-text"]',

    /**
     * Пузырь с текстом сообщения (markdown-обёртка).
     * Внутри: <span class="markdown…"><p>…</p></span>; может быть несколько <p>.
     */
    bubbleText: '[data-qa="chat-bubble-text"]',

    /**
     * Имя автора входящего сообщения (от работодателя).
     * Присутствует ТОЛЬКО у входящих; у исходящих (кандидата) отсутствует.
     */
    bubbleAuthorName: '[data-qa="chat-bubble-author-name"]',

    /**
     * Время отображения сообщения.
     * Примечание: в атрибуте hh.ru опечатка «buble» — это оригинальный data-qa.
     */
    bubbleDisplayTime: '[data-qa="chat-buble-display-time"]',

    /** Статус-иконка «прочитано» (у исходящих сообщений кандидата). */
    bubbleIconRead: '[data-qa="chat-bubble-icon-read"]',

    /** Статус-иконка «скрыто» (у исходящих сообщений кандидата). */
    bubbleIconHidden: '[data-qa="chat-bubble-icon-hidden"]',

    /** Блок действий кандидата в сообщении (у исходящих). */
    applicantAction: '[data-qa="chatik-chat-message-applicant-action"]',
  },

  // --- Поле ввода / отправка сообщения ---
  composer: {
    /** Textarea для набора нового сообщения. */
    newMessageText: '[data-qa="chatik-new-message-text"]',

    /** Кнопка «Отправить» новое сообщение. */
    sendButton: '[data-qa="chatik-do-send-message"]',

    /** Поле загрузки файла (input type=file). */
    uploadFileInput: '[data-qa="upload-file-input"]',

    /** Кнопка-триггер открытия диалога загрузки файла. */
    uploadFileButton: '[data-qa="upload-file-button"]',
  },
};

// === Селекторы страницы резюме (нативное «поднятие» резюме, M5.1) ===

/**
 * Селекторы для нативной кнопки активности резюме hh.ru.
 * Верифицированы по ЖИВОМУ DOM hh.ru/applicant/resumes (2026-06-26):
 * атрибут мульти-значный — data-qa="resume-update-button resume-update-button_actions",
 * поэтому матчим словом в списке через `~=`, не точным `=` (точное совпадение даёт 0 узлов).
 */
export const RESUME_SELECTORS = {
  /**
   * Нативная кнопка «поднять резюме в поиске» / «обновить дату».
   * Активное состояние: текст «Поднять в поиске».
   * Состояние кулдауна: текст «Обновить можно через {время}» (поднять ещё нельзя).
   * Аккаунт с одним резюме → ровно 1 узел; мультирезюме → несколько (strict-mode → not_found).
   */
  updateButton: '[data-qa~="resume-update-button"]',
};

/**
 * Тексты кнопки, когда поднятие ДОСТУПНО (кнопку можно нажать).
 * «Поднять в поиске» — основной активный лейбл; «Обновить дату» — вариант.
 */
export const RESUME_BUMP_READY_PATTERNS = [
  /поднять в\s*поиске/i,
  /обновить дату/i,
];

/**
 * Тексты кнопки в состоянии кулдауна (поднять ещё НЕЛЬЗЯ — идёт таймер).
 * Напр. «Обновить можно через 3 часа».
 */
export const RESUME_BUMP_COOLDOWN_PATTERNS = [
  /обновить можно через/i,
];

// === Паттерны apply-флоу (текст-/role-based, русский UI hh.ru) ===

/**
 * Ситуации, требующие ручного вмешательства (тест, обязательный вопрос и т.п.).
 * Используется в hasManualStepRequired / matchesAnyPattern.
 */
export const REQUIRED_MANUAL_PATTERNS = [
  /пройти тест/i,
  /тестовое задани[ея]/i,
  /ответ обязателен/i,
  /обязательный ответ/i,
  /заполните обязательные поля/i,
  /это поле необходимо заполнить/i
];

/**
 * Тексты кнопки «Откликнуться» на странице вакансии (точное совпадение, без учёта регистра).
 * Используется в clickFirstVisibleByText при первом нажатии.
 */
export const RESPONSE_BUTTON_TEXTS = [
  /^Откликнуться$/i,
  /^Откликнуться на вакансию$/i
];

/**
 * Тексты кнопок в процессе отклика (подтверждение, навигация по шагам формы).
 * Порядок соответствует приоритету в clickFirstVisibleByText.
 */
export const APPLICATION_FLOW_BUTTON_TEXTS = [
  /^Откликнуться$/i,
  /^Откликнуться на вакансию$/i,
  /^Отправить$/i,
  /^Отправить отклик$/i,
  /^Продолжить$/i,
  /^Далее$/i,
  /^Подтвердить$/i,
  /^Выбрать$/i,
  /^Выбрать резюме$/i
];

// Re-export для полноты реестра; единственный источник истины — src/lib/applied.js.
export { APPLIED_PATTERNS } from './applied.js';
