/**
 * src/lib/dashboardActions.js — чистые, dependency-injected обработчики команд панели
 * (вынесены из dashboard.js /api/* при переходе на Electron+IPC, без http req/res).
 *
 * Каждый handle* — чистая функция от (зависимости, тело запроса) к { status, body }.
 * status — исторический артефакт HTTP-эндпоинтов, сохранён для обратной совместимости
 * тестов/семантики (409 дубль, 400 валидация, 500 ошибка записи); IPC-обёртка в
 * electron-main.js отдаёт рендереру только body.
 */

import { writeFile } from 'node:fs/promises';

import { getLoginSentinelPath } from '../config.js';

/**
 * Пишет sentinel завершения панельного логина (M19.5): пустой файл logs/login-<account>.done.
 * login.js --panel проверяет только СУЩЕСТВОВАНИЕ файла (content не читается/не парсится →
 * нет инъекции). Путь скоуплен по аккаунту через getLoginSentinelPath (traversal-safe).
 */
export async function defaultWriteLoginDone(account) {
  await writeFile(getLoginSentinelPath(account), '');
}

/**
 * Запуск задачи (было POST /api/start). live — строго булев opt-in; дефолт dry-run.
 * limit/text/area только для apply.
 *
 * @param {{start: Function}} runner
 * @param {object} body
 * @returns {{status: number, body: object}}
 */
export function handleStart(runner, body) {
  const result = runner.start({
    task: body.task,
    account: body.account,
    live: body.live === true,
    limit: body.limit,
    text: body.text,
    area: body.area,
  });
  const { status, ...rest } = result;
  return { status: status || (result.ok ? 200 : 400), body: rest };
}

/**
 * Остановка задачи(-й) аккаунта (было POST /api/stop). task — опциональный фильтр (M12.7):
 * при указании останавливает только эту задачу аккаунта.
 *
 * @param {{stop: Function}} runner
 * @param {object} body
 * @returns {{status: number, body: object}}
 */
export function handleStop(runner, body) {
  const stopOpts = { account: body.account };
  if (body.task !== undefined) stopOpts.task = body.task;
  const result = runner.stop(stopOpts);
  const { status, ...rest } = result;
  return { status: status || (result.ok ? 200 : 400), body: rest };
}

/**
 * Сигнал завершения панельного логина (было POST /api/login-done, M19.5).
 *
 * @param {(account: string) => Promise<void>} writeLoginDone
 * @param {object} body
 * @returns {Promise<{status: number, body: object}>}
 */
export async function handleLoginDone(writeLoginDone, body) {
  const account = typeof body.account === 'string' ? body.account.trim() : '';
  if (!account) {
    return { status: 400, body: { ok: false, error: 'Параметр account обязателен' } };
  }
  try {
    await writeLoginDone(account);
  } catch {
    return { status: 500, body: { ok: false, error: 'Не удалось записать сигнал завершения логина' } };
  }
  // В ответ — только имя аккаунта (без cookies/PII/содержимого сессии).
  return { status: 200, body: { ok: true, account } };
}

/**
 * Снимок запущенных задач (было GET /api/tasks).
 *
 * @param {{list: Function}} runner
 * @returns {{status: number, body: object}}
 */
export function handleTasks(runner) {
  return { status: 200, body: { tasks: runner.list() } };
}

/**
 * Список аккаунтов (было GET /api/accounts).
 *
 * @param {Function} listAccountsFn
 * @returns {Promise<{status: number, body: object}>}
 */
export async function handleAccounts(listAccountsFn) {
  return { status: 200, body: { accounts: await listAccountsFn() } };
}
