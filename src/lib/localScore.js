// Локальный скоринг релевантности без обращения к модели.
// Используется для пропуска DeepSeek-вызова, когда сигнала достаточно.

import { extractResumeKeywords } from './knowledge.js';

/**
 * Вычисляет локальный скор релевантности вакансии по ключевым словам.
 * @param {string} vacancyText — текст вакансии.
 * @param {string} resume — текст резюме кандидата.
 * @returns {{ score: number, confident: boolean, demanded: number, overlap: number }}
 */
export function localRelevanceScore(vacancyText, resume) {
  const demandedList = extractResumeKeywords(vacancyText);
  const haveList = extractResumeKeywords(resume);
  const haveSet = new Set(haveList.map((kw) => kw.toLowerCase()));

  const overlap = demandedList.filter((kw) => haveSet.has(kw.toLowerCase())).length;
  const demanded = demandedList.length;
  const rawScore = demanded === 0 ? 50 : Math.round(100 * overlap / demanded);
  const score = Math.max(0, Math.min(100, rawScore));
  const confident = demanded >= 3;

  return { score, confident, demanded, overlap };
}

/**
 * Возвращает true, если для данной вакансии нужно вызывать модель.
 * Безопасная политика: локальный скоринг может только ОТКЛОНИТЬ вакансию
 * (уверенно-низкий балл ≤low), но никогда не «пропускает к отклику» — любой
 * потенциальный отклик всегда подтверждает модель. Это защищает реальные
 * отклики от ложного greenlight по одному только keyword-overlap.
 * @param {{ score: number, confident: boolean }} local
 * @param {{ low?: number }} [thresholds]
 * @returns {boolean}
 */
export function needsModelScoring(local, { low = 40 } = {}) {
  const confidentReject = local.confident && local.score <= low;
  return !confidentReject;
}
