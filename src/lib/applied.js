// Чистые предикаты для детекта «уже откликнулись» по видимому тексту страницы.
// Без сайд-эффектов, без импорта Playwright.

import { matchesAnyPattern } from './answers.js';

export const APPLIED_PATTERNS = [
  /отклик отправлен/i,
  /резюме отправлено/i,
  /вы откликнулись/i,
  /отклик уже отправлен/i,
  /работодатель получит/i
];

/**
 * Возвращает true, если текст страницы указывает, что отклик уже был отправлен.
 * @param {string} text — видимый текст страницы.
 * @returns {boolean}
 */
export function isAlreadyApplied(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  return matchesAnyPattern(text, APPLIED_PATTERNS);
}
