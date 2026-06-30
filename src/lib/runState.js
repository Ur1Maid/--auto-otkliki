// Чистый детектор состояния живого прогона для панели управления (M11.6).
// Две беды, которые панель должна показывать сразу (урок 2026-06-29: belonogov словил
// «Подтвердите, что вы не робот» на 529-й вакансии — в логе это всплыло постфактум):
//   1) антибот/капча — hh.ru требует подтвердить, что ты не робот → прогон стоит, нужно вмешаться;
//   2) зависание — хартбит давно не обновлялся ВНУТРИ рабочего окна (вне окна простой нормален).
//
// Все функции детерминированы от аргументов: не вызывают Date.now() / argless new Date(),
// не обращаются к файлам/сети/процессу/DOM. IO (чтение текста страницы, запись state в хартбит,
// warn в logs/alerts.jsonl через alerts.js) делает вызывающий живой код (review.js / daemon.js).
//
// БЕЗОПАСНОСТЬ: модуль только классифицирует. Текст страницы — untrusted (prompt-injection вектор);
// здесь он лишь матчится против фиксированных паттернов и НИКОГДА не становится селектором/командой.
// Наружу ничего из текста не возвращается — только булевы флаги и литералы состояния.
//
// Использование:
//   const captcha = detectAntiBot(pageText);                       // boolean
//   const stalled = detectStalledRun(hb, now, 120000, inHours);    // boolean
//   const state = resolveRunState({ pageTextOrSignals, heartbeat, now, thresholdMs,
//                                   withinWorkingHours });          // 'captcha' | 'stalled' | 'ok'

import { isStale } from './heartbeat.js';

/** Литералы состояния прогона (совпадают с полем heartbeat.state). */
export const RUN_STATE_OK = 'ok';
export const RUN_STATE_CAPTCHA = 'captcha';
export const RUN_STATE_STALLED = 'stalled';

/**
 * Текстовые признаки антибот-страницы hh.ru (русский UI, case-insensitive).
 * Расширять этот массив новыми регэкспами, а не хардкодить проверки в вызывающем коде.
 * Все якоря консервативны: лучше пропустить редкий вариант, чем ложно пометить рабочий прогон.
 */
export const ANTIBOT_PATTERNS = [
  /подтвердите,?\s*что вы не робот/i,
  /докажите,?\s*что вы не робот/i,
  /вы не робот/i,
  /я не робот/i,
  /\bcaptcha\b/i,
  /капч[аеиныйу]/i,
  /проверка безопасности/i,
  /подозрительн\S*\s+активност/i,
];

/**
 * Извлекает текст для матчинга антибот-паттернов из входа detectAntiBot.
 * Строка → она сама; объект → его поле `text` (если строка), иначе ''.
 */
function antiBotText(pageTextOrSignals) {
  if (typeof pageTextOrSignals === 'string') return pageTextOrSignals;
  if (pageTextOrSignals && typeof pageTextOrSignals === 'object') {
    return typeof pageTextOrSignals.text === 'string' ? pageTextOrSignals.text : '';
  }
  return '';
}

/**
 * Определяет, показывает ли страница антибот/капчу.
 *
 * Принимает либо текст страницы (строка), либо объект-сигнал:
 *   - `{ text }`        — текст матчится против ANTIBOT_PATTERNS;
 *   - `{ captcha: true }`/`{ antiBot: true }` — явный булев флаг (напр. по селектору капчи)
 *     считается срабатыванием независимо от текста.
 *
 * Никогда не бросает: мусор/не-строка/null → false.
 *
 * @param {string|{text?: string, captcha?: boolean, antiBot?: boolean}} pageTextOrSignals
 * @returns {boolean}
 */
export function detectAntiBot(pageTextOrSignals) {
  if (pageTextOrSignals && typeof pageTextOrSignals === 'object') {
    if (pageTextOrSignals.captcha === true || pageTextOrSignals.antiBot === true) {
      return true;
    }
  }
  const text = antiBotText(pageTextOrSignals);
  if (!text) return false;
  return ANTIBOT_PATTERNS.some((re) => re.test(text));
}

/**
 * Определяет, «завис» ли прогон: хартбит устарел И мы сейчас ВНУТРИ рабочего окна.
 *
 * Вне рабочего окна простой ожидаем (демон спит) → не «зависание». Поэтому stalled=true
 * только когда `withinWorkingHours` истинно. Свежесть оценивает heartbeat.isStale (та же
 * консервативная семантика: нет разбираемого ts → устарел).
 *
 * Никогда не бросает: невалидный `now` (isStale бросил бы TypeError) → false (не зависание),
 * чтобы детектор состояния не ронял живой цикл.
 *
 * @param {object} heartbeat — запись из buildHeartbeat (или прочитанная из файла)
 * @param {Date|number|string} now — текущий момент
 * @param {number} [thresholdMs] — порог устаревания (по умолчанию DEFAULT_STALE_THRESHOLD_MS в isStale)
 * @param {boolean} withinWorkingHours — внутри ли рабочего окна МСК (считает вызывающий через schedule.js)
 * @returns {boolean}
 */
export function detectStalledRun(heartbeat, now, thresholdMs, withinWorkingHours) {
  if (withinWorkingHours !== true) return false;
  try {
    return isStale(heartbeat, now, thresholdMs);
  } catch {
    return false;
  }
}

/**
 * Сводит входные сигналы к одному литералу состояния прогона.
 * Приоритет: капча важнее зависания (капча — конкретная причина простоя, требует человека).
 *
 * Никогда не бросает: любой сбой/мусор → 'ok' дефолтно нейтрален (но капча/зависание
 * детектятся в первую очередь — они важнее ложного «ok»).
 *
 * @param {object} [args]
 * @param {string|object} [args.pageTextOrSignals] — вход detectAntiBot
 * @param {object} [args.heartbeat] — хартбит для detectStalledRun
 * @param {Date|number|string} [args.now]
 * @param {number} [args.thresholdMs]
 * @param {boolean} [args.withinWorkingHours]
 * @returns {'captcha'|'stalled'|'ok'}
 */
export function resolveRunState(args) {
  const a = args && typeof args === 'object' ? args : {};
  if (detectAntiBot(a.pageTextOrSignals)) return RUN_STATE_CAPTCHA;
  if (detectStalledRun(a.heartbeat, a.now, a.thresholdMs, a.withinWorkingHours)) {
    return RUN_STATE_STALLED;
  }
  return RUN_STATE_OK;
}
