import { chromium } from 'playwright';
import { getAccountStorageStatePath } from './config.js';

export async function launchBrowser({ account = 'default', storageStatePath = getAccountStorageStatePath(account), useSavedSession = true } = {}) {
  const contextOptions = {
    viewport: { width: 1366, height: 900 },
    locale: 'ru-RU',
    timezoneId: 'Asia/Yekaterinburg'
  };

  if (useSavedSession) {
    contextOptions.storageState = storageStatePath;
  }

  const browser = await chromium.launch({
    headless: false,
    slowMo: 80
  });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  return { browser, context, page };
}

export async function dismissHarmlessPopups(page) {
  const harmlessLabels = [
    'Принять',
    'Понятно',
    'Хорошо',
    'Закрыть',
    'Не сейчас',
    'Позже'
  ];

  for (const label of harmlessLabels) {
    const button = page.getByRole('button', { name: label }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => {});
      await page.waitForTimeout(400);
    }
  }
}
