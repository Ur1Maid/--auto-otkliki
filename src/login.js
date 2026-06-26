import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { ensureAppDirs, getAccountSessionDir, getAccountStorageStatePath, normalizeAccountName } from './config.js';
import { launchBrowser } from './browser.js';
import { ask, confirm } from './prompts.js';

await ensureAppDirs();

function parseArgs(argv) {
  const args = { account: 'default' };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--account') args.account = argv[++index] || args.account;
  }

  args.account = normalizeAccountName(args.account);
  return args;
}

const args = parseArgs(process.argv.slice(2));
const storageStatePath = getAccountStorageStatePath(args.account);
await mkdir(getAccountSessionDir(args.account), { recursive: true });

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
