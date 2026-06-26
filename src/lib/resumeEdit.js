// Обновление резюме через РЕАЛЬНУЮ микро-правку текста «опыта работы» на hh.ru.
// Заменяет прежнюю кнопку «поднять в поиске» (выпилена): hh.ru обновляет дату резюме,
// когда текст реально меняется и сохраняется. Правка минимальна и обратима — toggle
// финальной точки в описании первого опыта работы.
//
// Схема:
//   microEditDescription(text) → { next, change }      ← чистая функция (без IO)
//   microEditResume(page, opts) → { changed, reason, ... } ← Playwright IO-обёртка
//
// Безопасность: dryRun === true по умолчанию (только превью, без сохранения).

import { RESUME_SELECTORS } from './selectors.js';

/** Страница со списком резюме кандидата. */
export const RESUMES_URL = 'https://hh.ru/applicant/resumes';

/**
 * Вычисляет микро-правку описания опыта: toggle финальной точки.
 * Чистая функция, детерминированная, обратимая:
 *   "…восстановления."  → "…восстановления"   (убрали точку)
 *   "…восстановления"   → "…восстановления."  (добавили точку)
 *
 * Хвостовые пробелы/переводы строк нормализуются (hh.ru их всё равно тримит),
 * поэтому правка гарантированно меняет сохраняемое значение → дата резюме обновится.
 *
 * @param {string} text — текущее значение описания
 * @returns {{ next: string, change: 'added_dot' | 'removed_dot' }}
 */
export function microEditDescription(text) {
  const s = typeof text === 'string' ? text : '';
  const trimmed = s.replace(/\s+$/, '');

  if (trimmed.endsWith('.')) {
    return { next: trimmed.slice(0, -1), change: 'removed_dot' };
  }
  return { next: `${trimmed}.`, change: 'added_dot' };
}

/**
 * Короткий «хвост» строки для безопасного лога (без полного текста резюме — PII).
 * @param {string} text
 * @returns {string}
 */
function tail(text) {
  return (typeof text === 'string' ? text : '').slice(-40);
}

/**
 * Обновляет резюме реальной микро-правкой описания первого опыта работы.
 * По умолчанию dry-run: читает текст и считает правку, но НЕ сохраняет.
 * Реальное сохранение только при явном dryRun: false.
 *
 * Все DOM-чтения resilient (.catch) — один сбой не роняет мульти-аккаунт прогон.
 * В лог пишем только «хвост» описания (последние символы) — не весь текст (PII).
 *
 * @param {import('playwright').Page} page — страница с активной сессией аккаунта
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<{ changed: boolean, reason: string, change?: string, beforeTail?: string, afterTail?: string }>}
 */
export async function microEditResume(page, opts = {}) {
  const { dryRun = true } = opts;

  try {
    // 1. Список резюме → берём hash первого резюме.
    await page.goto(RESUMES_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1500).catch(() => {});

    const href = await page
      .locator(RESUME_SELECTORS.resumeLink)
      .first()
      .getAttribute('href')
      .catch(() => null);

    const hashMatch = typeof href === 'string' ? href.match(/\/resume\/([0-9a-f]+)/i) : null;
    if (!hashMatch) {
      return { changed: false, reason: 'no_resume' };
    }
    const hash = hashMatch[1];

    // 2. Открываем форму редактирования первого опыта работы.
    const editUrl = `https://hh.ru/profile/edit/experience/0?resumeFrom=${hash}`;
    await page.goto(editUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1500).catch(() => {});

    const ta = page.locator(RESUME_SELECTORS.experienceDescription);
    const visible = await ta.isVisible().catch(() => false);
    if (!visible) {
      return { changed: false, reason: 'no_experience_field' };
    }

    // 3. Читаем текущее описание.
    const before = await ta.inputValue().catch(() => '');

    // Защита от потери данных: пустое/слишком короткое чтение НЕ правим и не сохраняем.
    // Если бы чтение видимого поля сорвалось (before=''), toggle дал бы ровно "." и в
    // live-режиме затёр бы реальное описание опыта. Настоящее описание всегда длиннее.
    if (before.trim().length < 2) {
      return { changed: false, reason: 'empty_field' };
    }

    const { next, change } = microEditDescription(before);

    if (next === before) {
      // Теоретически недостижимо (toggle всегда меняет), но не сохраняем «пустую» правку.
      return { changed: false, reason: 'no_change', change };
    }

    // 4. Dry-run: только превью, без сохранения.
    if (dryRun !== false) {
      return {
        changed: false,
        reason: 'dry_run',
        change,
        beforeTail: tail(before),
        afterTail: tail(next),
      };
    }

    // 5. Реальная правка: вписываем новое значение и сохраняем.
    await ta.fill(next);

    const saveBtn = page.locator(RESUME_SELECTORS.saveButton).first();
    const saveVisible = await saveBtn.isVisible().catch(() => false);
    if (!saveVisible) {
      // Кнопки сохранения нет — правку не подтвердить. Честно сообщаем, не врём про saved.
      return { changed: false, reason: 'save_button_not_found', change, beforeTail: tail(before), afterTail: tail(next) };
    }
    try {
      await saveBtn.click({ timeout: 10000 });
    } catch {
      return { changed: false, reason: 'save_failed', change, beforeTail: tail(before), afterTail: tail(next) };
    }
    // Ждём сохранения/редиректа — consistent со стилем других DOM-ожиданий в проекте.
    await page.waitForTimeout(2500).catch(() => {});

    console.log(`[resumeEdit] Резюме обновлено: ${change} (описание опыта).`);
    return {
      changed: true,
      reason: 'saved',
      change,
      beforeTail: tail(before),
      afterTail: tail(next),
    };
  } catch (err) {
    console.log('[resumeEdit] Ошибка при правке резюме:', err?.message ?? err);
    return { changed: false, reason: 'error' };
  }
}
