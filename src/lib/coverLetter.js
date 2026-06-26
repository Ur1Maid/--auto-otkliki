// Чистые предикаты для логики генерации сопроводительного письма.
// Без сайд-эффектов, без импорта Playwright.

const COVER_LETTER_REQUIRED_PATTERNS = [
  /сопроводительное письмо обязатель/i,
];

/**
 * Возвращает true, если текст страницы указывает, что сопроводительное письмо обязательно.
 * @param {string} pageText — видимый текст страницы.
 * @returns {boolean}
 */
export function coverLetterRequired(pageText) {
  if (typeof pageText !== 'string') return false;
  return COVER_LETTER_REQUIRED_PATTERNS.some((pattern) => pattern.test(pageText));
}

/**
 * Возвращает true, если сопроводительное письмо нужно генерировать.
 * Обязательное письмо генерируется всегда; опциональное — только при явно высоком балле
 * (score >= minScore). Если minScore/score не переданы, опциональные письма не генерируются.
 * @param {{ required: boolean, score?: number, minScore?: number }} opts
 * @returns {boolean}
 */
export function shouldGenerateCoverLetter({ required, score, minScore } = {}) {
  if (required) return true;
  if (Number.isFinite(score) && Number.isFinite(minScore) && score >= minScore) return true;
  return false;
}
