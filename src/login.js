import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import {
  ensureAppDirs,
  getAccountSessionDir,
  getAccountStorageStatePath,
  getLoginSentinelPath,
  normalizeAccountName,
} from './config.js';
import { launchBrowser } from './browser.js';
import { ask, confirm } from './prompts.js';
import { writeHeartbeatFile } from './lib/statusWriter.js';
import { waitForLoginSignal, LOGIN_PHASES, LOGIN_OUTCOMES } from './lib/loginSignal.js';

await ensureAppDirs();

function parseArgs(argv) {
  const args = { account: 'default', panel: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--account') args.account = argv[++index] || args.account;
    else if (arg === '--panel') args.panel = true;
  }

  args.account = normalizeAccountName(args.account);
  return args;
}

const args = parseArgs(process.argv.slice(2));
const storageStatePath = getAccountStorageStatePath(args.account);
await mkdir(getAccountSessionDir(args.account), { recursive: true });

if (args.panel) {
  // Панельный режим (M19.4): stdin недоступен, поэтому НЕ спрашиваем и НЕ читаем Enter.
  // Ждём сигнал завершения из панели (sentinel-файл), сессию сохраняем ТОЛЬКО по сигналу;
  // по таймауту существующую сессию НЕ трогаем (не портим рабочий вход при неудаче).
  const sentinelPath = getLoginSentinelPath(args.account);
  // Снимаем устаревший сигнал предыдущего запуска, чтобы не «завершиться» мгновенно.
  await rm(sentinelPath, { force: true }).catch(() => {});

  const { browser, context, page } = await launchBrowser({ account: args.account, useSavedSession: false });
  const heartbeat = (phase, lastEvent) => writeHeartbeatFile(args.account, {
    task: 'login',
    phase,
    lastEvent,
    state: 'ok',
    ts: new Date(),
  });

  try {
    await page.goto('https://hh.ru/login', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await heartbeat(LOGIN_PHASES.WAITING, 'login_waiting');
    console.log(`Войдите в hh.ru в открывшемся браузере для аккаунта "${args.account}". Нажмите «Готово» в панели, когда вход завершён.`);

    const { outcome } = await waitForLoginSignal({
      isDone: () => existsSync(sentinelPath),
    });

    if (outcome === LOGIN_OUTCOMES.SAVED) {
      await context.storageState({ path: storageStatePath });
      console.log(`Сессия сохранена: ${storageStatePath}`);
      await heartbeat(LOGIN_PHASES.SAVED, 'login_saved');
    } else {
      // Сейчас сюда попадает только outcome 'timeout' — isStopped не проброшен (M19.4).
      // Когда M19.5/M19.6 добавят стоп, здесь нужна ветка outcome==='stopped' →
      // LOGIN_PHASES.STOPPED, иначе стоп будет помечен как таймаут.
      console.log('Вход не завершён (таймаут) — сессия не изменена.');
      await heartbeat(LOGIN_PHASES.TIMEOUT, 'login_timeout');
    }
  } finally {
    await browser.close().catch(() => {});
    // Прибираем сигнал, чтобы следующий запуск начинался «чисто».
    await rm(sentinelPath, { force: true }).catch(() => {});
  }
} else {
  if (existsSync(storageStatePath)) {
    const overwrite = await confirm(`Сохраненная сессия для аккаунта "${args.account}" уже есть. Перезаписать ее?`);
    if (!overwrite) {
      console.log('Оставляю текущую сессию без изменений.');
      process.exit(0);
    }
  }

  const { browser, context, page } = await launchBrowser({ account: args.account, useSavedSession: false });

  try {
    await page.goto('https://hh.ru/login', { waitUntil: 'domcontentloaded' });
    console.log(`Войдите в hh.ru в открывшемся браузере для аккаунта "${args.account}".`);
    await ask('Когда вход завершен, нажмите Enter здесь...');
    await context.storageState({ path: storageStatePath });
    console.log(`Сессия сохранена: ${storageStatePath}`);
  } finally {
    await browser.close().catch(() => {});
  }
}
