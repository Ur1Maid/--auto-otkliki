// Чистый хелпер для построения компактного профиля резюме вместо полного текста.

import { extractResumeKeywords } from './knowledge.js';

/**
 * Строит короткую строку профиля резюме для передачи в скоринг.
 * Если резюме пустое/пробельное — возвращает ''.
 * Результат всегда не длиннее maxLen символов.
 */
export function buildResumeProfile(resume, maxLen = 600) {
  if (!resume || !resume.trim()) return '';

  // Первая непустая строка без ведущих markdown-символов и пробелов.
  const role = resume
    .split('\n')
    .map((line) => line.replace(/^[#\-\s]+/, '').trim())
    .find((line) => line.length > 0) || '';

  // Ключевые слова из RESUME_KEYWORDS, присутствующие в резюме, в исходном порядке.
  const skills = extractResumeKeywords(resume);

  const result = `Роль: ${role}\nНавыки: ${skills.join(', ')}`;

  return result.slice(0, maxLen).trim();
}
