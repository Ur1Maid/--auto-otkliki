// Чистый маппер фаз живого прогона откликов для панели «Сейчас» (M12.1).
// Панель должна показывать, ЧТО программа делает прямо сейчас: собирает вакансии,
// оценивает их, откликается, завершилась или упала — а при ошибке короткую ПРИЧИНУ
// (енам/литерал), а не сырой текст исключения (там может быть URL/PII/секрет).
//
// Все функции детерминированы от аргументов: не вызывают Date.now() / argless new Date(),
// не обращаются к файлам/сети/процессу/DOM. IO (запись logs/status/<account>.json через
// statusWriter, чтение now) делает вызывающий живой код (review.js).
//
// БЕЗОПАСНОСТЬ: classifyErrorReason НИКОГДА не возвращает текст исходного исключения —
// только заранее заданный литерал из ERROR_REASONS. Сообщение об ошибке hh.ru/Playwright
// может содержать URL вакансии или иные данные → его нельзя класть в heartbeat (контракт
// heartbeat.js: lastEvent несёт только метки-статусы, без PII).
//
// Использование:
//   await onPhase(RUN_PHASES.SCORING);              // в review.js, перед скорингом
//   const reason = classifyErrorReason(error);      // → 'timeout' | 'navigation' | ...
//   const phase = normalizePhase(value);            // нормализация прочитанного из файла

/**
 * Канонические фазы прогона откликов. Заморожены — расширять здесь, а не строками в коде.
 *   collecting — собирает вакансии из поиска (ещё нет пула);
 *   scoring    — оценивает релевантность вакансии i/total;
 *   applying   — откликается на вакансию i/total;
 *   done       — прогон аккаунта завершён;
 *   error      — текущий шаг упал (причина — отдельным литералом в lastEvent).
 */
export const RUN_PHASES = Object.freeze({
  COLLECTING: 'collecting',
  SCORING: 'scoring',
  APPLYING: 'applying',
  DONE: 'done',
  ERROR: 'error',
});

/** Множество допустимых значений фазы для быстрой проверки. */
const VALID_PHASES = new Set(Object.values(RUN_PHASES));

/** Фаза по умолчанию, если вход неизвестен/мусор. */
const DEFAULT_PHASE = RUN_PHASES.SCORING;

/**
 * Литералы причин ошибки. Это ЕДИНСТВЕННОЕ, что classifyErrorReason может вернуть —
 * сырой текст исключения наружу не уходит (защита от утечки URL/PII/секретов).
 *   timeout    — истёк таймаут (Playwright TimeoutError / «Timeout … exceeded»);
 *   navigation — сбой перехода/загрузки страницы (goto/navigation);
 *   network    — сетевая ошибка (net::ERR_…, ECONNRESET, fetch failed);
 *   detached   — узел отвалился из DOM (element is not attached / detached);
 *   closed     — браузер/страница/контекст закрыты (target closed);
 *   unknown    — не распознано (дефолт).
 */
export const ERROR_REASONS = Object.freeze({
  TIMEOUT: 'timeout',
  NAVIGATION: 'navigation',
  NETWORK: 'network',
  DETACHED: 'detached',
  CLOSED: 'closed',
  UNKNOWN: 'unknown',
});

/**
 * Паттерны распознавания причины ошибки по тексту/имени исключения. Сопоставление —
 * только для ВЫБОРА литерала; сам текст никогда не возвращается. Порядок важен:
 * специфичные причины (closed/detached) проверяются раньше общих (timeout/network).
 */
const ERROR_PATTERNS = [
  [ERROR_REASONS.CLOSED, /target (?:page,? )?(?:context|browser)?.*closed|browser has been closed|has been closed|context or browser/i],
  [ERROR_REASONS.DETACHED, /not attached|detached|element is not|node is detached/i],
  [ERROR_REASONS.NETWORK, /net::err|err_[a-z]|econnreset|econnrefused|enotfound|etimedout|socket hang up|fetch failed|network/i],
  [ERROR_REASONS.NAVIGATION, /navigat|goto|err_aborted|frame was detached during navigation|page\.goto/i],
  [ERROR_REASONS.TIMEOUT, /timeout|timed out|exceeded/i],
];

/**
 * Нормализует значение фазы к одному из RUN_PHASES.
 * Строка (без учёта регистра/пробелов) совпала с канонической → она; иначе fallback.
 * Никогда не бросает: не-строка/мусор → fallback.
 *
 * @param {string} value — значение фазы (например, прочитанное из файла статуса)
 * @param {string} [fallback] — что вернуть, если value не распознано (по умолчанию 'scoring')
 * @returns {string} каноническая фаза
 */
export function normalizePhase(value, fallback = DEFAULT_PHASE) {
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (VALID_PHASES.has(v)) return v;
  }
  return VALID_PHASES.has(fallback) ? fallback : DEFAULT_PHASE;
}

/**
 * Извлекает строку для матчинга из исключения: Error → `${name} ${message}`,
 * строка → она сама, иначе ''. Объекты, кроме Error, намеренно НЕ строкуются
 * целиком (защита от случайного протекания структур/PII).
 */
function errorText(error) {
  if (error instanceof Error) {
    const name = typeof error.name === 'string' ? error.name : '';
    const message = typeof error.message === 'string' ? error.message : '';
    return `${name} ${message}`;
  }
  if (typeof error === 'string') return error;
  return '';
}

/**
 * Сводит исключение к короткому литералу причины из ERROR_REASONS.
 * НИКОГДА не возвращает сырой текст исключения — только литерал (без PII/секретов).
 * Никогда не бросает: мусор/не-Error/нераспознанное → 'unknown'.
 *
 * @param {Error|string|*} error — исключение из живого флоу
 * @returns {string} один из ERROR_REASONS
 */
export function classifyErrorReason(error) {
  const text = errorText(error);
  if (!text.trim()) return ERROR_REASONS.UNKNOWN;
  for (const [reason, re] of ERROR_PATTERNS) {
    if (re.test(text)) return reason;
  }
  return ERROR_REASONS.UNKNOWN;
}

/**
 * Человекочитаемые (русские) метки причин ошибки для панели. Соответствуют ERROR_REASONS.
 * Неизвестный литерал → дефолтная метка «неизвестно».
 */
const REASON_LABELS = Object.freeze({
  [ERROR_REASONS.TIMEOUT]: 'таймаут',
  [ERROR_REASONS.NAVIGATION]: 'страница не загрузилась',
  [ERROR_REASONS.NETWORK]: 'сеть',
  [ERROR_REASONS.DETACHED]: 'элемент пропал',
  [ERROR_REASONS.CLOSED]: 'браузер закрыт',
  [ERROR_REASONS.UNKNOWN]: 'неизвестно',
});

/** Конечное положительное целое из значения, иначе null. */
function positiveInt(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

/**
 * Превращает снимок текущего шага прогона в короткую русскую фразу для блока «Сейчас».
 * Чистая: только из переданных полей, без IO/времени. Никогда не бросает.
 *
 * Примеры: «Собирает вакансии: 250», «Оценивает 12/40», «Откликается 12/40»,
 * «Ошибка: таймаут», «Капча», «Готово», «Простаивает».
 *
 * Приоритет: капча (state==='captcha') важнее фазы — на капче прогон стоит. Причину ошибки
 * берём из `lastEvent` (туда review.js кладёт литерал classifyErrorReason — без PII/URL).
 *
 * @param {object} [snapshot] — { phase, index, total, state, lastEvent }
 *   (совпадает с формой аккаунта из liveStatus.buildLiveView)
 * @returns {string} человекочитаемая фраза
 */
export function formatPhase(snapshot = {}) {
  const s = snapshot && typeof snapshot === 'object' ? snapshot : {};
  if (s.state === 'captcha') return 'Капча';

  const phase = typeof s.phase === 'string' ? s.phase.trim().toLowerCase() : '';
  const index = positiveInt(s.index);
  const total = positiveInt(s.total);
  const progress = index != null && total != null ? `${index}/${total}` : null;

  switch (phase) {
    case RUN_PHASES.COLLECTING: {
      // index/total ещё может не быть (пул не собран) — тогда без счётчика. Сегодняшний
      // producer (review.js) на сборе шлёт index:0/total:null → ветка index — forward-compat
      // на случай, если позже начнём слать «собрано N» инкрементально.
      const count = total != null ? total : index;
      return count != null ? `Собирает вакансии: ${count}` : 'Собирает вакансии…';
    }
    case RUN_PHASES.SCORING:
      return progress ? `Оценивает ${progress}` : 'Оценивает…';
    case RUN_PHASES.APPLYING:
      return progress ? `Откликается ${progress}` : 'Откликается…';
    case RUN_PHASES.DONE:
      return 'Готово';
    case RUN_PHASES.ERROR: {
      const reason = typeof s.lastEvent === 'string' ? s.lastEvent.trim().toLowerCase() : '';
      const label = REASON_LABELS[reason] || REASON_LABELS[ERROR_REASONS.UNKNOWN];
      return `Ошибка: ${label}`;
    }
    default:
      return 'Простаивает';
  }
}
