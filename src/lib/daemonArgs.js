// Чистые функции парсинга и маппинга аргументов дневного демона hh-auto-otkliki (M7).
// Без IO, сети, Date.now() — только парсинг строк и сборка argv.
//
// Безопасные дефолты:
//   dryRun: true   — live-режим требует явного --no-dry-run / --live (opt-in).
//   replyAuto: false — авто-отправка ответов требует --reply-auto.
//
// parseDaemonArgs(argv) → опции демона
// buildReviewChildArgs(opts) → argv для дочернего node src/review.js

/**
 * Парсит argv (массив строк, как process.argv.slice(2)) в опции демона.
 *
 * Дефолты SAFE:
 *   dryRun: true        — ничего не уходит наружу без явного opt-in.
 *   replyAuto: false    — авто-ответы выключены.
 *   accounts: ['default']
 *   limit: 200
 *   area: '1'
 *   messagesPollMinutes: 15
 *   microEditMinutes: 30
 *
 * Неизвестные флаги игнорируются.
 *
 * @param {string[]} argv — массив строк (process.argv.slice(2))
 * @returns {{
 *   accounts: string[],
 *   text: string,
 *   area: string,
 *   search: string,
 *   limit: number,
 *   dryRun: boolean,
 *   replyAuto: boolean,
 *   once: boolean,
 *   task: '' | 'apply' | 'messages' | 'resume',
 *   messagesPollMinutes: number,
 *   microEditMinutes: number,
 * }}
 * @throws {Error} если --limit задан мусором, нулём или отрицательным числом,
 *   либо если --task задан неизвестным значением.
 */
export function parseDaemonArgs(argv) {
  const args = {
    accounts: ['default'],
    text: '',
    area: '1',
    search: '',
    limit: 200,
    dryRun: true,           // ДЕФОЛТ SAFE: live-режим только по явному opt-in
    replyAuto: false,       // ДЕФОЛТ SAFE
    once: false,
    task: '',               // '' = цикл-планировщик; иначе один шаг и выход (для внешнего шедулера)
    messagesPollMinutes: 15,
    microEditMinutes: 30,
  };

  const safeArgv = Array.isArray(argv) ? argv : [];

  for (let i = 0; i < safeArgv.length; i++) {
    const arg = safeArgv[i];

    if (arg === '--accounts') {
      const raw = safeArgv[++i] || '';
      const parsed = raw.split(',').map((a) => a.trim()).filter(Boolean);
      args.accounts = parsed.length > 0 ? parsed : ['default'];

    } else if (arg === '--account') {
      const name = (safeArgv[++i] || '').trim();
      args.accounts = name ? [name] : ['default'];

    } else if (arg === '--text') {
      args.text = safeArgv[++i] || '';

    } else if (arg === '--area') {
      args.area = safeArgv[++i] || '1';

    } else if (arg === '--search') {
      args.search = safeArgv[++i] || '';

    } else if (arg === '--limit') {
      const raw = safeArgv[++i];
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(
          `Параметр --limit должен быть положительным числом, получено: ${raw}`
        );
      }
      args.limit = n;

    } else if (arg === '--no-dry-run' || arg === '--live') {
      // Явный opt-in в live-режим — dryRun выключается.
      args.dryRun = false;

    } else if (arg === '--reply-auto') {
      args.replyAuto = true;

    } else if (arg === '--once') {
      args.once = true;

    } else if (arg === '--task') {
      // Один шаг и выход — режим для внешнего шедулера (cron / Task Scheduler).
      // Алиасы: micro-edit/bump → resume; poll → messages.
      const raw = (safeArgv[++i] || '').trim().toLowerCase();
      const normalized =
        raw === 'micro-edit' || raw === 'bump' ? 'resume'
        : raw === 'poll' ? 'messages'
        : raw;
      const allowed = ['apply', 'messages', 'resume'];
      if (!allowed.includes(normalized)) {
        throw new Error(
          `Параметр --task должен быть одним из: ${allowed.join(', ')} (получено: ${raw || '<пусто>'})`
        );
      }
      args.task = normalized;

    } else if (arg === '--messages-interval') {
      const raw = safeArgv[++i];
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) {
        args.messagesPollMinutes = n;
      }

    } else if (arg === '--micro-edit-interval') {
      const raw = safeArgv[++i];
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) {
        args.microEditMinutes = n;
      }
    }
    // Неизвестные флаги игнорируются.
  }

  // Нормализация accounts: убрать пустые (уже сделано при split, но страховка).
  args.accounts = args.accounts.filter(Boolean);
  if (args.accounts.length === 0) args.accounts = ['default'];

  return args;
}

/**
 * Строит argv для дочернего вызова `node src/review.js`.
 *
 * Безопасность:
 *   dryRun: true  → добавляет '--dry-run' И '--manual' (двойная защита).
 *   !dryRun && autoApply: true → добавляет '--yes'.
 *   text/search — добавляются только если непустые.
 *
 * @param {{
 *   accounts: string[],
 *   text?: string,
 *   area?: string,
 *   search?: string,
 *   limit?: number,
 *   dryRun?: boolean,
 *   autoApply?: boolean,
 * }} opts
 * @returns {string[]}
 */
export function buildReviewChildArgs(opts = {}) {
  const {
    accounts = ['default'],
    text = '',
    area = '1',
    search = '',
    limit = 200,
    dryRun = true,          // ДЕФОЛТ SAFE
    autoApply = false,
  } = opts;

  const argv = [];

  // Аккаунты — всегда включаем.
  argv.push('--accounts', Array.isArray(accounts) ? accounts.join(',') : String(accounts));

  // Текстовый поиск — только если задан.
  if (typeof text === 'string' && text.trim()) {
    argv.push('--text', text.trim());
  }

  // Регион — всегда включаем если задан.
  if (area) {
    argv.push('--area', String(area));
  }

  // Поиск по URL — только если задан.
  if (typeof search === 'string' && search.trim()) {
    argv.push('--search', search.trim());
  }

  // Лимит — всегда включаем.
  argv.push('--limit', String(limit));

  // Безопасность: dryRun → двойная защита (--dry-run + --manual).
  if (dryRun) {
    argv.push('--dry-run', '--manual');
  } else if (autoApply) {
    // Live-режим с явным разрешением авто-отправки.
    argv.push('--yes');
  }

  return argv;
}
