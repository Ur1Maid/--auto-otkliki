// Resilient-обёртка для нативного «поднятия резюме» на hh.ru (M5.1).
// Нажимает кнопку [data-qa="resume-update-button"] только когда она реально доступна.
// По умолчанию работает в режиме dry-run: действие НЕ производится, только классифицируется.
//
// Схема:
//   classifyBumpButton({ visible, enabled, text }) → { canBump, reason }  ← чистая функция
//   bumpResume(frame, opts)                        → { bumped, reason }   ← IO-обёртка

import {
  RESUME_SELECTORS,
  RESUME_BUMP_READY_PATTERNS,
  RESUME_BUMP_COOLDOWN_PATTERNS,
} from './selectors.js';
import { matchesAnyPattern } from './answers.js';

/**
 * Классифицирует состояние кнопки «поднять резюме» по трём параметрам.
 * Чистая функция: без IO, без сайд-эффектов.
 *
 * Порядок ветвей (ранний возврат, менять нельзя — см. тесты):
 *   1. visible !== true           → not_found   (кнопки нет)
 *   2. text матчит cooldown       → cooldown    (идёт таймер)
 *   3. text матчит ready И !disabled → ready / canBump:true
 *   4. enabled === false          → disabled    (ready-паттерн не совпал / else)
 *   5. иначе                     → unknown     (консервативно — не жмём)
 *
 * @param {{ visible?: boolean, enabled?: boolean, text?: string }} opts
 * @returns {{ canBump: boolean, reason: string }}
 */
export function classifyBumpButton({ visible, enabled, text } = {}) {
  const safeText = typeof text === 'string' ? text : '';

  // 1. Кнопка отсутствует / скрыта.
  if (visible !== true) {
    return { canBump: false, reason: 'not_found' };
  }

  // 2. Кулдаун: «Обновить можно через …».
  if (matchesAnyPattern(safeText, RESUME_BUMP_COOLDOWN_PATTERNS)) {
    return { canBump: false, reason: 'cooldown' };
  }

  // 3. Кнопка активна: текст «Поднять в поиске» / «Обновить дату» + не задизейблена.
  if (matchesAnyPattern(safeText, RESUME_BUMP_READY_PATTERNS) && enabled !== false) {
    return { canBump: true, reason: 'ready' };
  }

  // 4. Элемент задизейблен (ready-паттерн либо не совпал, либо enabled===false).
  if (enabled === false) {
    return { canBump: false, reason: 'disabled' };
  }

  // 5. Текст не распознан — консервативно не нажимаем.
  return { canBump: false, reason: 'unknown' };
}

/**
 * Поднимает резюме через нативную кнопку hh.ru.
 * По умолчанию dry-run: возвращает ожидаемый результат БЕЗ реального клика.
 * Передай `dryRun: false` только в production-пути — действие меняет дату резюме на hh.ru.
 *
 * @param {import('playwright').Page | import('playwright').Frame} frame
 *   Playwright Page или Frame. В тестах — мок-объект с совместимым API.
 * @param {{ dryRun?: boolean, selector?: string }} opts
 *   dryRun по умолчанию true (безопасно).
 * @returns {Promise<{ bumped: boolean, reason: string }>}
 */
export async function bumpResume(frame, opts = {}) {
  const { dryRun = true, selector } = opts;
  const sel = selector ?? RESUME_SELECTORS.updateButton;

  try {
    const btn = frame.locator(sel);

    const visible = await btn.isVisible().catch(() => false);
    const enabled = await btn.isEnabled().catch(() => true);
    const text = await btn.innerText().catch(() => '');

    const state = classifyBumpButton({ visible, enabled, text });

    if (!state.canBump) {
      return { bumped: false, reason: state.reason };
    }

    // canBump === true — кнопка доступна.

    if (dryRun === true) {
      // Safety-gate: сухой прогон, клика нет.
      return { bumped: false, reason: 'dry_run' };
    }

    // Реальный клик (только когда dryRun явно false).
    await btn.click();
    console.log('[resumeBump] Резюме поднято в поиске.');
    return { bumped: true, reason: 'clicked' };

  } catch (err) {
    console.log('[resumeBump] Ошибка при поднятии резюме:', err?.message ?? err);
    return { bumped: false, reason: 'error' };
  }
}
