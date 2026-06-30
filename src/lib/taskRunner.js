// src/lib/taskRunner.js — реестр запущенных задач панели управления (M11.8).
//
// Тонкая управляющая обёртка над чистым taskControl.js (buildTaskCommand/canStart):
// спавнит `node src/daemon.js --task … --account … [--live]`, трекает дочерний процесс
// по аккаунту, останавливает его kill-ом. Spawn/kill инъектируются — тесты не трогают
// реальный process (см. .claude/rules/testing.md).
//
// БЕЗОПАСНОСТЬ (инвариант M11):
//   - dry-run по умолчанию: '--live' добавляется ТОЛЬКО при live === true (через buildTaskCommand).
//   - argv передаётся МАССИВОМ в spawn (без shell) — untrusted text/area не становятся
//     shell-командой.
//   - одна задача на аккаунт одновременно (canStart) — повторный старт отклоняется (409).
//   - в лог/ответ идут только account/task/pid — ни ключа, ни PII, ни текста писем.

import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';

import { rootDir } from '../config.js';
import { buildTaskCommand, canStart } from './taskControl.js';

const DAEMON_JS = path.join(rootDir, 'src', 'daemon.js');

/**
 * Создаёт реестр задач с инъекцией spawn/kill (для тестов — без реального process).
 *
 * @param {{
 *   spawn?: Function,        // (execPath, args, opts) → child-подобный объект {pid, on, kill}
 *   execPath?: string,       // путь к node (по умолчанию process.execPath)
 *   daemonPath?: string,     // путь к daemon.js (по умолчанию src/daemon.js)
 *   now?: () => number,      // источник времени для startedAt (по умолчанию Date.now)
 *   log?: (msg: string) => void, // best-effort логгер (без секретов/PII)
 * }} [deps]
 * @returns {{ start: Function, stop: Function, list: Function }}
 */
export function createTaskRunner(deps = {}) {
  const spawnFn = typeof deps.spawn === 'function' ? deps.spawn : nodeSpawn;
  const execPath = typeof deps.execPath === 'string' && deps.execPath ? deps.execPath : process.execPath;
  const daemonPath = typeof deps.daemonPath === 'string' && deps.daemonPath ? deps.daemonPath : DAEMON_JS;
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const log = typeof deps.log === 'function' ? deps.log : () => {};

  // account → { account, task, live, pid, startedAt, child }
  const running = new Map();

  /** Текущие задачи в форме, понятной canStart. */
  function runningEntries() {
    return [...running.values()].map((e) => ({ account: e.account, task: e.task }));
  }

  /** Публичный снимок запущенных задач (без child/секретов). */
  function list() {
    return [...running.values()].map((e) => ({
      account: e.account,
      task: e.task,
      pid: e.pid,
      live: e.live,
      startedAt: e.startedAt,
    }));
  }

  /**
   * Запускает задачу для аккаунта.
   *
   * @param {{task: string, account: string, live?: boolean, limit?: number|string,
   *          text?: string, area?: number|string}} opts
   * @returns {{ok: boolean, status: number, account?: string, task?: string,
   *            pid?: number, live?: boolean, reason?: string}}
   */
  function start(opts = {}) {
    // 1. Сборка argv (валидирует task/account, бросает на мусоре) → 400 при невалидном.
    let argv;
    try {
      argv = buildTaskCommand(opts);
    } catch (err) {
      return { ok: false, status: 400, reason: err.message };
    }

    // buildTaskCommand гарантирует порядок: ['--task', task, '--account', account, ...].
    const task = argv[1];
    const account = argv[3];
    const live = opts.live === true;

    // 2. Инвариант: одна задача на аккаунт. Дубль → 409.
    if (!canStart(runningEntries(), account, task)) {
      return { ok: false, status: 409, account, task, reason: 'Аккаунт уже занят другой задачей' };
    }

    // 3. Спавн дочернего процесса. argv — массивом, без shell.
    let child;
    try {
      child = spawnFn(execPath, [daemonPath, ...argv], { stdio: 'inherit' });
    } catch (err) {
      return { ok: false, status: 500, account, task, reason: err.message };
    }

    const pid = child && typeof child.pid === 'number' ? child.pid : null;
    const entry = { account, task, live, pid, startedAt: now(), child };
    running.set(account, entry);

    // Снимаем запись из реестра, когда процесс завершится (чтобы аккаунт освободился).
    const cleanup = () => {
      if (running.get(account) === entry) running.delete(account);
    };
    if (child && typeof child.on === 'function') {
      child.on('exit', cleanup);
      child.on('close', cleanup);
      child.on('error', cleanup);
    }

    // Лог без секретов/PII: только task/account/live/pid. Префикс различает live/dry-run,
    // чтобы аудит логов отделял реальные отправки наружу от прогонов вхолостую.
    const prefix = live ? 'LIVE запущен оператором' : 'dry-run запущен';
    log(`[control] ${prefix}: ${task}/${account} (live=${live}, pid=${pid})`);
    return { ok: true, status: 200, account, task, pid, live };
  }

  /**
   * Останавливает задачу аккаунта: kill трекаемого процесса.
   * ЗАМЕЧАНИЕ: для --task apply daemon спавнит review.js внуком — kill родителя на Windows
   * не валит всё дерево; apply — разовый батч, это приемлемо в рамках M11.8.
   *
   * @param {{account: string}} opts
   * @returns {{ok: boolean, status: number, account?: string, task?: string, reason?: string}}
   */
  function stop(opts = {}) {
    const account = typeof opts.account === 'string' ? opts.account.trim() : '';
    if (!account) return { ok: false, status: 400, reason: 'Параметр account обязателен' };

    const entry = running.get(account);
    if (!entry) return { ok: false, status: 404, account, reason: 'Нет запущенной задачи для аккаунта' };

    try {
      if (entry.child && typeof entry.child.kill === 'function') {
        entry.child.kill('SIGTERM');
      }
    } catch {
      // best-effort: процесс мог уже завершиться.
    }
    running.delete(account);

    log(`[control] Остановлено оператором: ${entry.task}/${account}`);
    return { ok: true, status: 200, account, task: entry.task };
  }

  return { start, stop, list };
}
