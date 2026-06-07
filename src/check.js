import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { ensureAppDirs, storageStatePath } from './config.js';

await ensureAppDirs();

console.log(`Node.js: ${process.version}`);
console.log(`Playwright chromium доступен: ${Boolean(chromium)}`);
console.log(`Сессия hh.ru: ${existsSync(storageStatePath) ? 'найдена' : 'не найдена'}`);
