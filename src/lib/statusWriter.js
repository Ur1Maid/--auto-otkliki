// src/lib/statusWriter.js — запись «хартбита» живого прогона в logs/status/<account>.json (M11.2).
//
// Тонкая IO-обёртка над чистым buildHeartbeat (heartbeat.js): нормализует поля и перезаписывает
// файл статуса аккаунта на каждом шаге живого флоу (review.js / daemon.js). Панель управления
// (M11.11) читает эти файлы, чтобы показать текущую задачу/шаг/прогресс и индикатор живости.
//
// Best-effort: любая ошибка IO молча проглатывается — запись статуса НИКОГДА не должна ронять
// живой прогон откликов/сообщений/правок. mkdir вызывается каждый раз (recursive), чтобы не
// зависеть от порядка ensureAppDirs у вызывающего; частота записи низкая (раз на вакансию/шаг).
//
// БЕЗОПАСНОСТЬ: пишем только то, что вернул buildHeartbeat — числа/шаги/счётчики. Вызывающий
// обязан не класть в lastEvent секреты/PII/текст писем (контракт см. в heartbeat.js).

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { buildHeartbeat } from './heartbeat.js';
import { getAccountStatusPath } from '../config.js';

/**
 * Перезаписывает logs/status/<account>.json текущим хартбитом.
 * Никогда не бросает: ошибка IO → возвращает null (запись статуса не критична).
 *
 * @param {string} account — имя аккаунта (подставляется в хартбит, перекрывая fields.account)
 * @param {object} fields — поля для buildHeartbeat (task/phase/index/total/lastEvent/state/ts)
 * @param {object} [deps] — инъекция IO для тестов: { writeFile, mkdir, getStatusPath }
 * @returns {Promise<object|null>} записанный хартбит или null при сбое
 */
export async function writeHeartbeatFile(account, fields, deps = {}) {
  const write = deps.writeFile || writeFile;
  const mkDir = deps.mkdir || mkdir;
  const statusPathFor = deps.getStatusPath || getAccountStatusPath;
  try {
    const hb = buildHeartbeat({ ...fields, account });
    const filePath = statusPathFor(account);
    await mkDir(path.dirname(filePath), { recursive: true });
    await write(filePath, `${JSON.stringify(hb, null, 2)}\n`, 'utf8');
    return hb;
  } catch {
    // Запись статуса — наблюдаемость, не корректность: не роняем прогон из-за IO.
    return null;
  }
}
