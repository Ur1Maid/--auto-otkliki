// Чистый модуль управления задачами демона hh-auto-otkliki (M11.7).
// Без IO, сети, Date.now() — только сборка argv и проверка занятости аккаунта.
//
// Безопасные дефолты:
//   live: false — live-режим требует явного live:true (opt-in).
//
// buildTaskCommand(opts) → string[]   — argv для node src/daemon.js
// canStart(runningTasks, account, task) → boolean — одна задача на аккаунт

const ALLOWED_TASKS = ['apply', 'messages', 'resume'];

/**
 * Нормализует значение task: алиасы, trim, lowercase.
 * Возвращает нормализованную строку или null при неизвестном значении.
 *
 * Алиасы: poll→messages, bump/micro-edit→resume.
 *
 * @param {string} raw
 * @returns {string|null}
 */
function normalizeTask(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (t === 'poll') return 'messages';
  if (t === 'bump' || t === 'micro-edit') return 'resume';
  if (ALLOWED_TASKS.includes(t)) return t;
  return null;
}

/**
 * Строит argv для запуска `node src/daemon.js ...argv`.
 *
 * Безопасность:
 *   live: false (дефолт) → флаг --live НЕ добавляется (dry-run по умолчанию на стороне демона).
 *   live: true  → добавляет '--live' (явный opt-in).
 *
 * limit/text/area добавляются ТОЛЬКО для задачи apply; для messages/resume игнорируются.
 *
 * @param {{
 *   task: string,
 *   account: string,
 *   live?: boolean,
 *   limit?: number|string,
 *   text?: string,
 *   area?: number|string,
 * }} opts
 * @returns {string[]}
 * @throws {Error} если task или account невалидны.
 */
export function buildTaskCommand({ task, account, live = false, limit, text, area } = {}) {
  // Валидация task.
  const normalizedTask = normalizeTask(task == null ? '' : String(task));
  if (normalizedTask === null) {
    const raw = (task == null ? '' : String(task)).trim().toLowerCase() || '<пусто>';
    throw new Error(
      `Параметр task должен быть одним из: apply, messages, resume (получено: ${raw})`
    );
  }

  // Валидация account.
  const trimmedAccount = typeof account === 'string' ? account.trim() : '';
  if (!trimmedAccount) {
    throw new Error('Параметр account обязателен');
  }

  const argv = [];

  // Порядок: --task, --account, затем apply-only поля, затем --live последним.
  argv.push('--task', normalizedTask);
  argv.push('--account', trimmedAccount);

  // apply-only: limit, text, area.
  if (normalizedTask === 'apply') {
    // --text: только непустая строка.
    if (typeof text === 'string' && text.trim()) {
      argv.push('--text', text.trim());
    }

    // --area: только непустое значение после String()/trim().
    if (area != null) {
      const areaStr = String(area).trim();
      if (areaStr) {
        argv.push('--area', areaStr);
      }
    }

    // --limit: только если целое положительное число (count). Дробное → floor.
    if (limit != null) {
      const n = Math.floor(Number(limit));
      if (Number.isFinite(n) && n >= 1) {
        argv.push('--limit', String(n));
      }
    }
  }

  // --live: ТОЛЬКО при явном live === true (ключевой инвариант безопасности).
  if (live === true) {
    argv.push('--live');
  }

  return argv;
}

/**
 * Проверяет, можно ли запустить задачу для аккаунта.
 *
 * Инвариант M11: одна задача на аккаунт одновременно.
 * Возвращает false если аккаунт уже занят (любой задачей), task неизвестен,
 * или account невалиден.
 *
 * @param {Array<{account: string, task: string}>} runningTasks — текущие задачи.
 * @param {string} account — имя аккаунта.
 * @param {string} task — задача (с поддержкой алиасов).
 * @returns {boolean}
 */
export function canStart(runningTasks, account, task) {
  // Защита: account должен быть непустой строкой.
  const trimmedAccount = typeof account === 'string' ? account.trim() : '';
  if (!trimmedAccount) return false;

  // Защита: task должен нормализоваться в известное значение.
  const normalizedTask = normalizeTask(task == null ? '' : String(task));
  if (normalizedTask === null) return false;

  // Защита: runningTasks должен быть массивом.
  const tasks = Array.isArray(runningTasks) ? runningTasks : [];

  // Проверяем, занят ли аккаунт (любой задачей, case-sensitive).
  for (const entry of tasks) {
    // Пропускаем некорректные записи.
    if (entry == null || typeof entry !== 'object') continue;
    if (typeof entry.account !== 'string' || !entry.account) continue;

    if (entry.account === trimmedAccount) {
      // Аккаунт уже занят — запуск невозможен.
      return false;
    }
  }

  return true;
}
