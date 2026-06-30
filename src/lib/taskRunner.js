// src/lib/taskRunner.js — реестр запущенных задач панели управления (M11.8, обновлён M12.5).
//
// Тонкая управляющая обёртка над чистым taskControl.js (buildTaskCommand/canStart):
// спавнит `node src/daemon.js --task … --account … [--live]`, трекает дочерний процесс
// по паре (account, task), останавливает его kill-ом. Spawn/kill инъектируются — тесты не трогают
// реальный process (см. .claude/rules/testing.md).
//
// БЕЗОПАСНОСТЬ (инвариант M12.5):
//   - dry-run по умолчанию: '--live' добавляется ТОЛЬКО при live === true (через buildTaskCommand).
//   - argv передаётся МАССИВОМ в spawn (без shell) — untrusted text/area не становятся
//     shell-командой.
//   - одна задача данного ТИПА на аккаунт (account+task); apply+messages+resume могут идти
//     параллельно (M12.5) — повторная пара отклоняется (409).
//   - в лог/ответ идут только account/task/pid — ни ключа, ни PII, ни текста писем.

import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';

import { rootDir } from '../config.js';
import { buildTaskCommand, canStart, normalizeTask } from './taskControl.js';

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

  // Составной ключ реестра: "account\0task" — NUL-разделитель исключает коллизии имён.
  const keyOf = (account, task) => `${account}\0${task}`;

  // (account\0task) → { account, task, live, pid, startedAt, child }
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

    // 2. Инвариант: одна задача данного типа на аккаунт. Та же пара → 409.
    if (!canStart(runningEntries(), account, task)) {
      return { ok: false, status: 409, account, task, reason: 'Эта задача для аккаунта уже запущена' };
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
    running.set(keyOf(account, task), entry);

    // Снимаем запись из реестра, когда процесс завершится (чтобы пара account+task освободилась).
    const cleanup = () => {
      if (running.get(keyOf(account, task)) === entry) running.delete(keyOf(account, task));
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
   * Останавливает задачу(-и) аккаунта: kill трекаемого процесса.
   * ЗАМЕЧАНИЕ: для --task apply daemon спавнит review.js внуком — kill родителя на Windows
   * не валит всё дерево; apply — разовый батч, это приемлемо в рамках M11.8.
   *
   * opts.task (опционально): если указан — нормализуется через normalizeTask (алиасы
   *   разрешаются: poll→messages, bump/micro-edit→resume). Неизвестное значение → 400.
   *   Если не указан — останавливает ВСЕ задачи аккаунта.
   *
   * Возвращает:
   *   ровно одна задача → { ok, status:200, account, task }   (обратная совместимость).
   *   несколько задач   → { ok, status:200, account, stopped: string[] }.
   *
   * @param {{account: string, task?: string}} opts
   * @returns {{ok: boolean, status: number, account?: string, task?: string,
   *            stopped?: string[], reason?: string}}
   */
  function stop(opts = {}) {
    const account = typeof opts.account === 'string' ? opts.account.trim() : '';
    if (!account) return { ok: false, status: 400, reason: 'Параметр account обязателен' };

    // Фильтр по task (опциональный): нормализуем через normalizeTask — алиасы разрешаются,
    // неизвестное значение возвращает null → 400. Если opts.task не указан — wantTask=null,
    // останавливаем все задачи аккаунта.
    let wantTask = null;
    if (typeof opts.task === 'string' && opts.task.trim()) {
      const rawTask = opts.task.trim();
      wantTask = normalizeTask(rawTask);
      if (wantTask === null) {
        return { ok: false, status: 400, account, reason: 'Неизвестная задача: ' + rawTask };
      }
    }

    // Собираем все совпадающие записи.
    const matches = [];
    for (const e of running.values()) {
      if (e.account !== account) continue;
      if (wantTask !== null && e.task !== wantTask) continue;
      matches.push(e);
    }

    if (matches.length === 0) {
      return { ok: false, status: 404, account, reason: 'Нет запущенной задачи для аккаунта' };
    }

    for (const entry of matches) {
      try {
        if (entry.child && typeof entry.child.kill === 'function') {
          entry.child.kill('SIGTERM');
        }
      } catch {
        // best-effort: процесс мог уже завершиться.
      }
      running.delete(keyOf(entry.account, entry.task));
      log(`[control] Остановлено оператором: ${entry.task}/${entry.account}`);
    }

    // Обратная совместимость: одна задача → task-поле; несколько → stopped-массив.
    if (matches.length === 1) {
      return { ok: true, status: 200, account, task: matches[0].task };
    }
    return { ok: true, status: 200, account, stopped: matches.map((e) => e.task) };
  }

  return { start, stop, list };
}
