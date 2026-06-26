/**
 * src/daemon.js — Дневной демон hh-auto-otkliki (M7).
 *
 * Что делает:
 *   Orchestrates автоматические прогоны откликов, поллинг сообщений и микро-правки
 *   резюме в рамках рабочих часов МСК (09:00–18:00) с изоляцией ошибок по шагам.
 *
 * Как остановить:
 *   1. Создать файл DAEMON_STOP в корне репозитория → цикл завершится после текущего шага.
 *   2. Ctrl-C (SIGINT) → аналогично, выход после текущего шага.
 *
 * БЕЗОПАСНОСТЬ — dryRun включён по умолчанию:
 *   Без явного --no-dry-run / --live ни один отклик, ответ или правка не уйдут наружу.
 *   Live-режим активируется только явным opt-in с заметным предупреждением в логе.
 *
 * Запуск (режим цикла-планировщика, держит процесс открытым):
 *   node src/daemon.js [--accounts acc1,acc2] [--text DevOps] [--area 1] [--limit 200]
 *                      [--no-dry-run | --live] [--reply-auto] [--once]
 *                      [--messages-interval 15] [--micro-edit-interval 30]
 *
 * Запуск (режим ОДНОГО шага и выхода — для внешнего шедулера cron / Task Scheduler):
 *   node src/daemon.js --task messages   # прочитать все письма (каждые 10 мин)
 *   node src/daemon.js --task resume      # обновить/поднять резюме (каждые 30 мин)
 *   node src/daemon.js --task apply --limit 200   # пачка откликов (08:00 МСК)
 *   С --task процесс НЕ крутится: делает один шаг, пишет дневной отчёт и выходит.
 *   Рабочие часы МСК НЕ проверяются (временем управляет шедулер ОС).
 */

import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { decideNextAction, ACTIONS } from './lib/daemonPlan.js';
import { isStopRequested, runIsolatedTask } from './lib/isolate.js';
import { createDailyReport, dailyReportFileName } from './lib/dailyReport.js';
import { processUnread } from './messages.js';
import { createProcessedTracker } from './lib/replySend.js';
import { microEditResume } from './lib/resumeEdit.js';
import { loadAccountProfile } from './lib/accountProfile.js';
import { launchBrowser } from './browser.js';
import { rootDir, logsDir } from './config.js';
import { confirm } from './prompts.js';
import { parseDaemonArgs, buildReviewChildArgs } from './lib/daemonArgs.js';

// Путь к review.js — дочерний процесс apply-прогона.
const REVIEW_JS = path.join(rootDir, 'src', 'review.js');

// Дефолты DeepSeek (совпадают с review.js) — нужны generateReply в ответах на сообщения.
const DEFAULT_DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';

// STOP-файл демона (отдельный от ralph/STOP).
const DAEMON_STOP_FILE = path.join(rootDir, 'DAEMON_STOP');

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------

/**
 * Простой sleep-примитив.
 *
 * @param {number} ms — миллисекунды
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms > 0 ? ms : 0));
}

/**
 * Запускает дочерний процесс node и ждёт его завершения.
 * Наследует stdio (inherit), чтобы логи review.js видны в консоли демона.
 *
 * @param {string[]} args — argv для node (первым — путь к скрипту)
 * @returns {Promise<number>} — код выхода процесса
 */
function spawnNode(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 0));
    child.on('error', (err) => {
      console.error('[daemon] Ошибка запуска дочернего процесса:', err.message);
      resolve(1);
    });
  });
}

// ---------------------------------------------------------------------------
// Шаги демона (вызываются через runIsolatedTask — изоляция ошибок снаружи)
// ---------------------------------------------------------------------------

/**
 * Шаг APPLY_RUN: запускает node src/review.js с нужными аргументами.
 * dryRun прокидывается в buildReviewChildArgs → по умолчанию даёт --dry-run --manual.
 *
 * Статистика не детализируется — review.js сам пишет logs/summary-*.json.
 *
 * @param {object} opts — результат parseDaemonArgs
 * @param {object} report — createDailyReport()
 * @returns {Promise<void>}
 */
export async function runApplyPass(opts, report) {
  console.log(`[daemon] → APPLY_RUN: аккаунты [${opts.accounts.join(', ')}], dryRun=${opts.dryRun}`);

  const childArgs = buildReviewChildArgs({
    accounts: opts.accounts,
    text: opts.text,
    area: opts.area,
    search: opts.search,
    limit: opts.limit,
    dryRun: opts.dryRun,
    autoApply: !opts.dryRun, // live-режим: авто-отклики включены, если dryRun=false
  });

  console.log('[daemon] review.js args:', childArgs.join(' '));

  const exitCode = await spawnNode([REVIEW_JS, ...childArgs]);
  console.log(`[daemon] review.js завершился с кодом ${exitCode}`);

  // report.recordAccountRun не вызываем — числа возьмём из summary-*.json (review делает сам).
  // Вместо этого фиксируем токены как 0 (нет прямого доступа без парсинга jsonl).
  void report; // используется вызывающим для recordMessages и т.п.
}

/**
 * Шаг POLL_MESSAGES: для каждого аккаунта открывает браузер и вызывает processUnread.
 * Каждый аккаунт изолирован — сбой одного не роняет остальные.
 *
 * API-ключ берётся из process.env.DEEPSEEK_API_KEY (уже загруженного в окружение).
 * Ключ в лог не пишется.
 *
 * @param {object} opts — результат parseDaemonArgs
 * @param {object} report — createDailyReport()
 * @param {object} tracker — createProcessedTracker() (идемпотентность за сессию)
 * @returns {Promise<void>}
 */
export async function runMessagesPass(opts, report, tracker) {
  console.log(`[daemon] → POLL_MESSAGES: аккаунты [${opts.accounts.join(', ')}], dryRun=${opts.dryRun}`);

  // API-ключ из окружения — в лог не пишем.
  const apiKey = process.env.DEEPSEEK_API_KEY || '';

  for (const account of opts.accounts) {
    let browser;
    try {
      const launched = await launchBrowser({ account, useSavedSession: true });
      browser = launched.browser;
      const { page } = launched;

      // Полный deepSeekContext: ключ + URL/модель + профиль аккаунта (резюме/зарплата),
      // иначе generateReply не имеет ни эндпоинта, ни данных кандидата → всё в manual.
      // Профиль скоупится по аккаунту (loadAccountProfile) — без утечки между аккаунтами.
      // Ключ не логируется (processUnread его не пишет).
      const { resumeProfile, salary } = await loadAccountProfile(account);
      const deepSeekContext = {
        apiKey,
        apiUrl: process.env.DEEPSEEK_API_URL || DEFAULT_DEEPSEEK_API_URL,
        model: process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
        resumeProfile,
        salary,
      };

      // confirmFn: если не replyAuto — спрашиваем оператора через промпт.
      const confirmFn = opts.replyAuto
        ? undefined
        : (preview) => confirm(`[daemon] Отправить ответ в чате?\n${preview}\n`);

      const result = await processUnread(page, {
        account,
        dryRun: opts.dryRun,
        replyAuto: opts.replyAuto,
        deepSeekContext,
        tracker,
        confirmFn,
      });

      console.log(
        `[daemon] [${account}] Сообщения: обработано ${result.processed}, ` +
        `ответов ${result.replied}, пропущено ${result.skipped}, ` +
        `вручную ${result.manual}, ошибок ${result.errors}`
      );

      report.recordMessages({
        processed: result.processed,
        replied: result.replied,
        skippedNoReply: result.skipped,
        manual: result.manual,
      });
    } catch (err) {
      // Изоляция аккаунта: один не роняет день.
      console.error(`[daemon] [${account}] Ошибка поллинга сообщений: ${err.message}`);
    } finally {
      // Браузер закрываем на всех путях.
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }
}

/**
 * Шаг MICRO_EDIT: обновление резюме реальной микро-правкой текста «опыта работы».
 *
 * Для каждого аккаунта открывает резюме и вызывает microEditResume: toggle финальной
 * точки в описании первого опыта → hh.ru обновляет дату резюме при сохранении. dryRun
 * наследуется из opts (по умолчанию true — только превью, без сохранения).
 *
 * Изоляция аккаунта: один сбой не роняет остальные; браузер закрывается в finally.
 * В лог пишем только «хвост» описания (microEditResume) — не весь текст резюме (PII).
 *
 * @param {object} opts — результат parseDaemonArgs
 * @param {object} report — createDailyReport()
 * @returns {Promise<void>}
 */
export async function runMicroEditPass(opts, report) {
  console.log(`[daemon] → MICRO_EDIT: правка резюме, аккаунты [${opts.accounts.join(', ')}], dryRun=${opts.dryRun}`);

  for (const account of opts.accounts) {
    let browser;
    try {
      const launched = await launchBrowser({ account, useSavedSession: true });
      browser = launched.browser;
      const { page } = launched;

      const result = await microEditResume(page, { dryRun: opts.dryRun });
      const diff = result.change ? ` [${result.change}: "${result.beforeTail}" → "${result.afterTail}"]` : '';
      console.log(`[daemon] [${account}] Правка резюме: ${result.reason} (changed=${result.changed})${diff}`);

      // В отчёт: applied только при реально сохранённой правке. dry-run → не applied.
      report.recordResumeEdit({ account, applied: result.changed });
    } catch (err) {
      // Изоляция аккаунта: один не роняет день.
      console.error(`[daemon] [${account}] Ошибка правки резюме: ${err.message}`);
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }
}

/**
 * Записывает дневной отчёт в logs/ (best-effort — IO-сбой не роняет демон).
 *
 * @param {object} report — createDailyReport()
 * @returns {Promise<void>}
 */
async function writeDailyReport(report) {
  try {
    const now = new Date();
    const fileName = dailyReportFileName(now);
    const filePath = path.join(logsDir, fileName);
    const data = report.snapshot(now);
    await writeFile(filePath, JSON.stringify(data, null, 2));
    console.log(`[daemon] Дневной отчёт записан: ${filePath}`);
  } catch (err) {
    // best-effort — не роняем демон из-за IO
    console.error('[daemon] Не удалось записать дневной отчёт:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Режим одного шага (--task) — для внешнего шедулера
// ---------------------------------------------------------------------------

/**
 * Выполняет ОДИН шаг (apply | messages | resume) и выходит. Рабочие часы МСК
 * не проверяются: расписанием управляет внешний шедулер (cron / Task Scheduler).
 * Это «демон запускает программу», а не крутится постоянно — дёшево по ресурсам на сервере.
 *
 * @param {object} opts — результат parseDaemonArgs (opts.task задан)
 * @returns {Promise<void>}
 */
export async function runSingleTask(opts) {
  const report = createDailyReport();
  const tracker = createProcessedTracker();

  console.log(`[daemon] Режим одного шага: --task ${opts.task} (без цикла, выход после шага).`);

  let result;
  switch (opts.task) {
    case 'apply':
      result = await runIsolatedTask(runApplyPass, opts, report);
      break;
    case 'messages':
      result = await runIsolatedTask(runMessagesPass, opts, report, tracker);
      break;
    case 'resume':
      result = await runIsolatedTask(runMicroEditPass, opts, report);
      break;
    default:
      console.error(`[daemon] Неизвестный --task: ${opts.task}`);
      return;
  }

  if (result && !result.ok) {
    console.error(`[daemon] Шаг ${opts.task} завершился с ошибкой:`, result.error.message);
  }

  await writeDailyReport(report);
  console.log(`[daemon] Итог шага: ${report.formatLine()}`);
  console.log('[daemon] Завершение (--task).');
}

// ---------------------------------------------------------------------------
// Главный цикл
// ---------------------------------------------------------------------------

/**
 * Главная функция демона.
 * Не запускается при импорте — только при прямом вызове скрипта.
 *
 * @returns {Promise<void>}
 */
export async function main() {
  const opts = parseDaemonArgs(process.argv.slice(2));

  // Грузим .env (как review.js/check.js): шаг messages читает DEEPSEEK_API_KEY из process.env.
  // Без этого generateReply не имеет ключа → все треды уходят в manual (0 ответов).
  // Ключ не логируем. .env может отсутствовать — переменные могут быть заданы в окружении.
  try {
    process.loadEnvFile(path.join(rootDir, '.env'));
  } catch {
    // .env отсутствует — не критично, ключ может прийти из окружения.
  }

  // --- Лог старта ---
  console.log('[daemon] ====================================');
  console.log('[daemon] hh-auto-otkliki дневной демон (M7)');
  console.log('[daemon] ====================================');
  console.log(`[daemon] Аккаунты: ${opts.accounts.join(', ')}`);
  console.log(`[daemon] Параметры: text="${opts.text}", area=${opts.area}, limit=${opts.limit}`);
  console.log(`[daemon] messagesPollMinutes=${opts.messagesPollMinutes}, microEditMinutes=${opts.microEditMinutes}`);

  if (opts.dryRun) {
    console.log('[daemon] Режим: DRY-RUN (дефолт). Никаких реальных действий не будет.');
    console.log('[daemon] Для live-режима используйте --no-dry-run или --live.');
  } else {
    // ЗАМЕТНОЕ предупреждение о live-режиме.
    console.log('[daemon] !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.log('[daemon] ВНИМАНИЕ: LIVE-РЕЖИМ. Действия уйдут наружу на hh.ru!');
    console.log('[daemon] !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  }

  // Режим одного шага: делаем ровно один шаг и выходим (внешний шедулер управляет временем).
  if (opts.task) {
    await runSingleTask(opts);
    return;
  }

  if (opts.once) {
    console.log('[daemon] --once: выход после первого выполненного шага (не STOP/IDLE).');
  }

  // --- STOP-файл и сигнал ---
  let signalStop = false;
  process.on('SIGINT', () => {
    signalStop = true;
    console.log('\n[daemon] Получен Ctrl-C, остановка после текущего шага...');
  });

  // --- Инициализация состояния ---
  const report = createDailyReport();
  const tracker = createProcessedTracker(); // идемпотентность сообщений за сессию

  const state = {
    startupDone: false,
    lastMessagesPollAt: null,
    lastMicroEditAt: null,
  };

  let didRealWork = false; // для --once: выходим после первой не-IDLE/STOP итерации

  // ---------------------------------------------------------------------------
  // Главный цикл
  // ---------------------------------------------------------------------------
  while (true) {
    // a. Проверяем флаги остановки.
    const stop = isStopRequested({
      stopFileExists: existsSync(DAEMON_STOP_FILE),
      signalReceived: signalStop,
    });
    if (stop) {
      console.log('[daemon] Остановка по запросу (DAEMON_STOP файл или SIGINT).');
      break;
    }

    // b. Решение планировщика.
    const decision = decideNextAction({
      now: new Date(),
      state,
      config: {
        messagesPollMinutes: opts.messagesPollMinutes,
        microEditMinutes: opts.microEditMinutes,
      },
    });

    // c. Лог решения.
    console.log(`[daemon] Решение: ${decision.action} (${decision.reason})`);

    // d. Диспетч действия.
    switch (decision.action) {
      case ACTIONS.STOP: {
        // Вне рабочих часов МСК — день закончен.
        // Выход из while — ниже, по проверке decision.action === ACTIONS.STOP.
        console.log('[daemon] Вне рабочих часов МСК. Демон останавливается до следующего рабочего окна.');
        break;
      }

      case ACTIONS.APPLY_RUN: {
        const result = await runIsolatedTask(runApplyPass, opts, report);
        if (!result.ok) {
          console.error('[daemon] APPLY_RUN завершился с ошибкой:', result.error.message);
        }
        state.startupDone = true;
        didRealWork = true;
        break;
      }

      case ACTIONS.POLL_MESSAGES: {
        const result = await runIsolatedTask(runMessagesPass, opts, report, tracker);
        if (!result.ok) {
          console.error('[daemon] POLL_MESSAGES завершился с ошибкой:', result.error.message);
        }
        state.lastMessagesPollAt = new Date();
        didRealWork = true;
        break;
      }

      case ACTIONS.MICRO_EDIT: {
        const result = await runIsolatedTask(runMicroEditPass, opts, report);
        if (!result.ok) {
          console.error('[daemon] MICRO_EDIT завершился с ошибкой:', result.error.message);
        }
        state.lastMicroEditAt = new Date();
        didRealWork = true;
        break;
      }

      case ACTIONS.IDLE: {
        const waitMins = decision.nextCheckInMinutes ?? 1;
        console.log(`[daemon] Ожидание ${waitMins.toFixed(1)} мин. до следующего шага...`);

        // Спим кусками по 10 сек, проверяя SIGINT между ними.
        const totalMs = waitMins * 60 * 1000;
        const chunkMs = 10_000;
        let remaining = totalMs;
        while (remaining > 0) {
          // Проверяем флаги остановки между сегментами сна.
          const stopMid = isStopRequested({
            stopFileExists: existsSync(DAEMON_STOP_FILE),
            signalReceived: signalStop,
          });
          if (stopMid) {
            console.log('[daemon] Остановка во время ожидания.');
            signalStop = true; // пробрасываем, чтобы внешняя проверка тоже сработала
            break;
          }
          await sleep(Math.min(chunkMs, remaining));
          remaining -= chunkMs;
        }
        // IDLE не засчитывается как «реальная работа» для --once.
        break;
      }

      default:
        console.log(`[daemon] Неизвестное действие: ${decision.action}`);
    }

    // Выход из цикла по STOP-действию (goto_end: break выше выходит только из switch).
    if (decision.action === ACTIONS.STOP) {
      break;
    }

    // e. --once: выходим после первого выполненного реального шага.
    if (opts.once && didRealWork) {
      console.log('[daemon] --once: первый шаг выполнен, выходим.');
      break;
    }
  }

  // ---------------------------------------------------------------------------
  // Дневной отчёт
  // ---------------------------------------------------------------------------
  await writeDailyReport(report);

  console.log(`[daemon] Итог дня: ${report.formatLine()}`);
  console.log('[daemon] Завершение.');
}

// ---------------------------------------------------------------------------
// Точка входа — запускаем только при прямом вызове скрипта.
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('[daemon] Фатальная ошибка:', e.message);
    process.exit(1);
  });
}
