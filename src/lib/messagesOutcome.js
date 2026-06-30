// Чистый классификатор + метки ИСХОДА поллинга сообщений (M18.5).
//
// Боль: задача «Сообщения» в панели «падала почти сразу» — даже штатный пустой
// результат (чат не найден / нет новых сообщений) выглядел как сбой, а реальная ошибка
// вообще не доходила до хартбита (catch только писал в console). Этот модуль различает
// ШТАТНЫЕ пустые исходы и обработку, чтобы панель показывала их понятной фразой, а не
// «падением». РЕАЛЬНАЯ ошибка обрабатывается отдельно (classifyErrorReason в runPhase.js,
// phase='error') — здесь её нет.
//
// Все функции чистые и детерминированы от аргументов: без IO/времени/процесса, никогда
// не бросают. Наружу идут только заранее заданные литералы/метки — без PII/текста письма.

/**
 * Канонические литералы исхода поллинга сообщений. Заморожены.
 *   chat_not_found — getChatFrame вернул null (страница чата не открылась/не нашлась);
 *   no_new         — чат найден, но обрабатывать нечего (нет новых тредов);
 *   processed      — чат найден, хотя бы один тред реально осмотрен.
 */
export const MESSAGE_OUTCOMES = Object.freeze({
  CHAT_NOT_FOUND: 'chat_not_found',
  NO_NEW: 'no_new',
  PROCESSED: 'processed',
});

/** Множество допустимых литералов исхода для быстрой проверки. */
const VALID_OUTCOMES = new Set(Object.values(MESSAGE_OUTCOMES));

/**
 * Сводит результат processUnread к литералу исхода.
 * Приоритет: чат не найден > нет новых > обработано.
 * Никогда не бросает: мусор/не-объект → 'no_new' (безопасный «делать нечего»).
 *
 * @param {{ chatFound?: boolean, processed?: number }} [result] — результат processUnread
 * @returns {string} один из MESSAGE_OUTCOMES
 */
export function classifyMessagesOutcome(result) {
  const r = result && typeof result === 'object' ? result : {};
  if (r.chatFound === false) return MESSAGE_OUTCOMES.CHAT_NOT_FOUND;
  const processed = Number.isFinite(r.processed) ? r.processed : 0;
  return processed > 0 ? MESSAGE_OUTCOMES.PROCESSED : MESSAGE_OUTCOMES.NO_NEW;
}

/**
 * Проверяет, является ли строка известным литералом исхода сообщений.
 * Используется formatPhase, чтобы на phase='done' показать метку исхода (а не общее «Готово»).
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isMessagesOutcome(value) {
  return typeof value === 'string' && VALID_OUTCOMES.has(value);
}

/** Человекочитаемые (русские) метки исхода для панели. */
const OUTCOME_LABELS = Object.freeze({
  [MESSAGE_OUTCOMES.CHAT_NOT_FOUND]: 'Чат не найден',
  [MESSAGE_OUTCOMES.NO_NEW]: 'Нет новых сообщений',
  [MESSAGE_OUTCOMES.PROCESSED]: 'Готово',
});

/**
 * Метка исхода для UI. Неизвестный литерал → «Готово» (нейтральный завершённый исход).
 *
 * @param {string} outcome — один из MESSAGE_OUTCOMES
 * @returns {string} русская метка
 */
export function messagesOutcomeLabel(outcome) {
  return OUTCOME_LABELS[outcome] || OUTCOME_LABELS[MESSAGE_OUTCOMES.PROCESSED];
}
