// Чистый детектор «почему сбор вакансий не дал результата» по видимому тексту/URL страницы (M18.2).
// Задача «Отклики» при таймауте сбора (collectVacanciesForAccount > COLLECT_VACANCIES_TIMEOUT_MS)
// пишет общий error-хартбит с причиной `timeout` — а она СКРЫВАЕТ настоящую беду. Обычно это:
//   1) разлогин/редирект на вход (сессия истекла) → нужно перелогиниться;
//   2) пустой поиск (по запросу ничего не найдено) → таймаута на самом деле нет, просто нет вакансий.
// Вызывающий код (review.js, M18.3) читает текст страницы в таймаут-ветке и подменяет общий
// `timeout` на конкретную причину, которую панель показывает словами.
//
// Без сайд-эффектов, без импорта Playwright. Текст/URL страницы — untrusted (prompt-injection
// вектор): здесь он лишь матчится против фиксированных паттернов и НИКОГДА не становится
// селектором/командой; наружу из текста ничего не возвращается — только литерал состояния.
//
// ЖИВАЯ ВЕРИФИКАЦИЯ: формулировки ниже — сид по типовым русским фразам hh.ru, но точные
// тексты разлогина/пустого поиска нуждаются в подтверждении живым HTML от пользователя (follow-up).
// Паттерны легко дополнить новым регэкспом, как любые text-паттерны (см. playwright.md).
//
// Кириллица-safe: НЕ используем `\b`/`\w`-границы (на кириллице ломаются — урок M11.6 runState.js).

import { ERROR_REASONS } from './runPhase.js';

/** Литералы состояния сбора (используются в heartbeat lastEvent/state вызывающим кодом). */
export const COLLECT_OK = 'ok';
export const COLLECT_LOGGED_OUT = 'logged_out';
export const COLLECT_EMPTY_SEARCH = 'empty_search';

/**
 * Литерал heartbeat.state при разлогине. Совпадает с liveStatus.LIVENESS_LOGGED_OUT и
 * веткой formatPhase `state==='logged_out'` (M19.1) — держим локальной строкой, чтобы не
 * тянуть UI-модули в чистый детектор. Значение = COLLECT_LOGGED_OUT (без дрейфа литерала).
 */
export const HEARTBEAT_STATE_LOGGED_OUT = COLLECT_LOGGED_OUT;
export const HEARTBEAT_STATE_OK = COLLECT_OK;

/**
 * Текстовые признаки разлогина / редиректа на страницу входа hh.ru (русский UI, case-insensitive).
 * Расширять этот массив новыми регэкспами, а не хардкодить проверки в вызывающем коде.
 * Формулировки — сид; нуждаются в живой верификации от пользователя (см. шапку файла).
 */
export const LOGGED_OUT_PATTERNS = [
  /войдите в аккаунт/i,
  /войдите,?\s*чтобы/i,
  /вход в аккаунт/i,
  /войти на hh/i,
  /авторизуйтесь/i,
];

/**
 * Признаки URL страницы входа (когда поиск редиректит на логин).
 */
export const LOGIN_URL_PATTERNS = [
  /\/account\/login/i,
  /\/auth\/login/i,
];

/**
 * Текстовые признаки пустого поиска hh.ru (русский UI, case-insensitive).
 * Расширять этот массив новыми регэкспами, а не хардкодить проверки в вызывающем коде.
 * Формулировки — сид; нуждаются в живой верификации от пользователя (см. шапку файла).
 */
export const EMPTY_SEARCH_PATTERNS = [
  /по вашему запросу ничего не найдено/i,
  /ничего не найдено/i,
  /не найдено ни одной вакансии/i,
  /вакансий не найдено/i,
];

/**
 * Извлекает {text, url} из входа detectCollectProblem.
 * Строка → трактуется как текст страницы; объект → его поля `text`/`url` (если строки).
 */
function collectSignals(pageTextOrSignals) {
  if (typeof pageTextOrSignals === 'string') {
    return { text: pageTextOrSignals, url: '' };
  }
  if (pageTextOrSignals && typeof pageTextOrSignals === 'object') {
    return {
      text: typeof pageTextOrSignals.text === 'string' ? pageTextOrSignals.text : '',
      url: typeof pageTextOrSignals.url === 'string' ? pageTextOrSignals.url : '',
    };
  }
  return { text: '', url: '' };
}

/**
 * Классифицирует, почему сбор вакансий не дал результата, по тексту/URL страницы.
 *
 * Принимает либо текст страницы (строка), либо объект-сигнал `{ text?, url? }`.
 * Приоритет: `logged_out` > `empty_search` > `ok` (разлогин — корневая причина: при нём
 * поиск и не мог отработать, поэтому проверяется первым).
 *
 * Никогда не бросает: мусор/не-строка/null → `'ok'`.
 *
 * @param {string|{text?: string, url?: string}} pageTextOrSignals
 * @returns {'logged_out'|'empty_search'|'ok'}
 */
export function detectCollectProblem(pageTextOrSignals) {
  const { text, url } = collectSignals(pageTextOrSignals);

  if (url && LOGIN_URL_PATTERNS.some((re) => re.test(url))) return COLLECT_LOGGED_OUT;
  if (text && LOGGED_OUT_PATTERNS.some((re) => re.test(text))) return COLLECT_LOGGED_OUT;
  if (text && EMPTY_SEARCH_PATTERNS.some((re) => re.test(text))) return COLLECT_EMPTY_SEARCH;
  return COLLECT_OK;
}

/**
 * Маппит результат detectCollectProblem в поля heartbeat, которые пишет живой флоу
 * (review.js в таймаут-ветке сбора; messages-путь daemon.js): `{ lastEvent, state }`.
 *
 *   logged_out   → lastEvent='auth',    state='logged_out'
 *                  (M19.1: панель покажет «Сессия разлогинена — нужен вход» + красную точку;
 *                   приоритет выше stalled — без входа задача не сдвинется);
 *   empty_search → lastEvent='empty',   state='ok' (пустой поиск — не разлогин, не «зависание»);
 *   ok/прочее    → lastEvent='timeout', state='ok' (настоящий таймаут: причину не вскрыли).
 *
 * Причина-литерал берётся из ERROR_REASONS (единый источник, без дубля строк). Чистая,
 * никогда не бросает: неизвестный вход → timeout/ok.
 *
 * @param {'logged_out'|'empty_search'|'ok'|*} problem — результат detectCollectProblem
 * @returns {{ lastEvent: string, state: string }}
 */
export function collectProblemHeartbeat(problem) {
  if (problem === COLLECT_LOGGED_OUT) {
    return { lastEvent: ERROR_REASONS.AUTH, state: HEARTBEAT_STATE_LOGGED_OUT };
  }
  if (problem === COLLECT_EMPTY_SEARCH) {
    return { lastEvent: ERROR_REASONS.EMPTY, state: HEARTBEAT_STATE_OK };
  }
  return { lastEvent: ERROR_REASONS.TIMEOUT, state: HEARTBEAT_STATE_OK };
}
