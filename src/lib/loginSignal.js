// Ожидание сигнала завершения ручного логина из панели (M19.4).
//
// Проблема: `src/login.js` в интерактиве ждёт `ask('нажмите Enter')` на stdin. При запуске
// из панели/демона stdin нет (M16.2 → confirm/ask сразу возвращают отказ), поэтому логин бы
// СРАЗУ «завершился» и сохранил НЕзалогиненную сессию. Решение: панельный логин ждёт СИГНАЛ
// ИЗ ПАНЕЛИ (sentinel-файл `logs/login-<account>.done`, пишется эндпоинтом M19.5), а не stdin.
//
// Этот модуль — ЧИСТАЯ логика ожидания: без IO, без реальных таймеров, без браузера. Всё
// нестабильное (наличие сигнала, время, sleep) инъектируется, что делает функцию тестируемой
// без файловой системы и Playwright. Реальную проверку sentinel (existsSync) и запись сессии
// делает вызывающий (login.js).
//
// Публичный API:
//   waitForLoginSignal(opts) → { outcome, waitedMs }

/** Фазы логина для хартбита панели (task='login'). Заморожены — расширять здесь. */
export const LOGIN_PHASES = Object.freeze({
  WAITING: 'login_waiting', // браузер открыт, ждём завершения входа оператором
  SAVED: 'login_saved',     // получен сигнал → сессия сохранена
  TIMEOUT: 'login_timeout', // истёк лимит ожидания → сессия НЕ тронута
  STOPPED: 'login_stopped', // получен стоп → сессия НЕ тронута
});

/** Исходы ожидания сигнала. */
export const LOGIN_OUTCOMES = Object.freeze({
  SAVED: 'saved',     // оператор подтвердил вход → вызывающий сохраняет storageState
  TIMEOUT: 'timeout', // истёк таймаут → НЕ сохранять (не портим существующую сессию)
  STOPPED: 'stopped', // запрошен стоп → НЕ сохранять
});

/** Лимит ожидания входа по умолчанию: 5 минут. */
export const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** Интервал опроса сигнала по умолчанию: 1 секунда. */
export const DEFAULT_LOGIN_POLL_MS = 1000;

/**
 * Безопасно вызывает предикат: любое исключение трактуется как «сигнала нет» (false).
 * Ожидание не должно падать из-за сбоя проверки (напр. гонка на файловой системе).
 */
async function safeSignal(fn) {
  if (typeof fn !== 'function') return false;
  try {
    return Boolean(await fn());
  } catch {
    return false;
  }
}

/**
 * Ждёт сигнал завершения логина, опрашивая инъецированные предикаты, пока не наступит один из:
 *   - `isDone()` вернул истину  → outcome 'saved'  (оператор подтвердил вход);
 *   - `isStopped()` вернул истину → outcome 'stopped' (запрошена остановка);
 *   - истёк `timeoutMs`         → outcome 'timeout' (сессию НЕ трогать).
 *
 * Приоритет проверок в каждой итерации: done > stopped > timeout. «Готово» важнее стопа —
 * если оператор успел подтвердить вход, сохраняем сессию, даже если параллельно пришёл стоп.
 *
 * Никогда не бросает: сбой предиката = «сигнала нет». Детерминирована от инъекций (now/sleep),
 * поэтому тестируется без реальных таймеров и файлов.
 *
 * @param {{
 *   isDone?: () => boolean | Promise<boolean>,
 *   isStopped?: () => boolean | Promise<boolean>,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   timeoutMs?: number,
 *   pollMs?: number,
 * }} [opts]
 * @returns {Promise<{ outcome: string, waitedMs: number }>}
 */
export async function waitForLoginSignal(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};

  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0
    ? o.timeoutMs
    : DEFAULT_LOGIN_TIMEOUT_MS;
  const pollMs = Number.isFinite(o.pollMs) && o.pollMs >= 0
    ? o.pollMs
    : DEFAULT_LOGIN_POLL_MS;
  const now = typeof o.now === 'function' ? o.now : () => Date.now();
  const sleep = typeof o.sleep === 'function'
    ? o.sleep
    : (ms) => new Promise((r) => setTimeout(r, ms));

  const start = now();

  while (true) {
    if (await safeSignal(o.isDone)) {
      return { outcome: LOGIN_OUTCOMES.SAVED, waitedMs: now() - start };
    }
    if (await safeSignal(o.isStopped)) {
      return { outcome: LOGIN_OUTCOMES.STOPPED, waitedMs: now() - start };
    }
    if (now() - start >= timeoutMs) {
      return { outcome: LOGIN_OUTCOMES.TIMEOUT, waitedMs: now() - start };
    }
    await sleep(pollMs);
  }
}
