// Чистый слой структурированных предложений по улучшению резюме.
// Получает статистику из summary (buildResumeUpgradeReport) и строит
// машинно-применимые ADDITIVE-предложения без вызова модели.
// Ничего не добавляет от себя — только реальные названия навыков из статистики.

import { extractResumeKeywords, normalizeText } from './knowledge.js';

/** Максимум навыков-кандидатов в блоке навыков (как skillsLimit в review.js). */
export const DEFAULT_SKILLS_LIMIT = 30;

/** Навык должен встретиться не менее N раз, чтобы попасть в кандидаты. */
export const DEFAULT_MIN_FREQUENCY = 2;

/**
 * Нормализует параметр-лимит к целому числу > 0.
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizeLimit(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * Нормализует порог частоты к целому числу >= 1.
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizeMinFrequency(value, fallback) {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

/**
 * Строит человекочитаемое обоснование для кандидата на добавление.
 * @param {number} frequency - Сколько раз навык встречался в вакансиях.
 * @param {number} vacanciesSeen - Общее число просмотренных вакансий.
 * @returns {string}
 */
function buildJustification(frequency, vacanciesSeen) {
  const base = `Встречается в ${frequency} вакансиях`;
  const tail = vacanciesSeen > 0 ? ` из ${vacanciesSeen} просмотренных` : '';
  return `${base}${tail}; добавлять только при наличии реального опыта.`;
}

/**
 * Проверяет, присутствует ли навык в тексте резюме как отдельное слово.
 *
 * Дополняет extractResumeKeywords (тот ограничен whitelist RESUME_KEYWORDS):
 * ловит навыки ВНЕ whitelist (напр. Jenkins) и whitelist-навыки с хвостовой
 * пунктуацией (напр. «Helm.»), которые иначе ошибочно попали бы в additive-
 * предложения — прямое нарушение honesty-инварианта на пути к правке резюме.
 *
 * Граница — любой не-буквенно-цифровой символ (или край строки) с обеих сторон;
 * внутренняя техно-пунктуация навыка (`.`, `+`, `#`, `/`, `-`) экранируется и
 * остаётся частью искомого. Намеренно ГЕНЕРАТИВНА: при сомнении считаем навык
 * присутствующим (тогда мы его НЕ предлагаем — безопасное направление ошибки).
 *
 * @param {string} normSkill - Нормализованное имя навыка (normalizeText).
 * @param {string} normResume - Нормализованный текст резюме (normalizeText).
 * @returns {boolean}
 */
function isSkillInResumeText(normSkill, normResume) {
  if (!normSkill || !normResume) return false;
  const escaped = normSkill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-zа-яё0-9])${escaped}([^a-zа-яё0-9]|$)`, 'i').test(normResume);
}

/**
 * Строит структурированные ADDITIVE-предложения по расширению резюме навыками.
 * Чистая функция — детерминирована, без IO/сети/вызовов модели.
 *
 * Honesty-гарантии:
 *  - Никогда не утверждает, что у кандидата ЕСТЬ навык.
 *  - Каждое предложение несёт requiresRealExperience: true.
 *  - Предлагает только навыки, которых ещё НЕТ в резюме (additive).
 *  - Не генерирует текст-выдумку — только реальные названия из статистики.
 *
 * @param {object} params
 * @param {object} params.summary - Статистика прогона (из buildResumeUpgradeReport).
 * @param {string} params.resumeText - Текущий текст резюме кандидата.
 * @param {number} [params.skillsLimit] - Максимум предложений (default: DEFAULT_SKILLS_LIMIT).
 * @param {number} [params.minFrequency] - Минимальная частота (default: DEFAULT_MIN_FREQUENCY).
 * @returns {{
 *   vacanciesSeen: number,
 *   relevantVacancies: number,
 *   skillSuggestions: Array<{skill:string, frequency:number, requiresRealExperience:true, justification:string}>,
 *   alreadyPresent: Array<{skill:string, frequency:number}>,
 * }}
 *
 * Примечание: `alreadyPresent` — ИНФОРМАЦИОННЫЙ список (навык уже в резюме); он
 * НЕ несёт requiresRealExperience и НЕ должен порождать правок в M6.2.
 */
export function buildResumeSuggestions({ summary, resumeText, skillsLimit, minFrequency } = {}) {
  // --- нормализация входов ---
  const safeSummary = (summary !== null && typeof summary === 'object') ? summary : {};
  const safeResume = typeof resumeText === 'string' ? resumeText : '';
  const limit = normalizeLimit(skillsLimit, DEFAULT_SKILLS_LIMIT);
  const minFreq = normalizeMinFrequency(minFrequency, DEFAULT_MIN_FREQUENCY);

  const vacanciesSeen = Number.isFinite(safeSummary.vacanciesSeen) ? Math.floor(safeSummary.vacanciesSeen) : 0;
  const relevantVacancies = Number.isFinite(safeSummary.relevantVacancies) ? Math.floor(safeSummary.relevantVacancies) : 0;
  const topKeywords = Array.isArray(safeSummary.topKeywords) ? safeSummary.topKeywords : [];

  // --- множество навыков, уже присутствующих в резюме (whitelist RESUME_KEYWORDS) ---
  const present = new Set(extractResumeKeywords(safeResume).map(normalizeText));
  // Доп. проверка по сырому тексту ловит навыки вне whitelist (см. isSkillInResumeText).
  const normResume = normalizeText(safeResume);

  // --- дедуп по нормализованному имени; при повторе храним МАКС. частоту
  // (не полагаемся на предварительную сортировку входа) ---
  const suggestionMap = new Map(); // normSkill -> { skill, frequency }
  const presentMap = new Map();    // normSkill -> { skill, frequency }

  for (const entry of topKeywords) {
    // пропускаем битые элементы
    if (!entry || typeof entry.name !== 'string' || entry.name.trim() === '') continue;
    if (!Number.isFinite(entry.count) || entry.count <= 0) continue;

    const frequency = Math.floor(entry.count);
    if (frequency < minFreq) continue;

    const skill = entry.name;
    const normSkill = normalizeText(skill);
    const target = (present.has(normSkill) || isSkillInResumeText(normSkill, normResume))
      ? presentMap
      : suggestionMap;

    const existing = target.get(normSkill);
    if (!existing || frequency > existing.frequency) {
      target.set(normSkill, { skill, frequency });
    }
  }

  const skillSuggestions = [...suggestionMap.values()].map(({ skill, frequency }) => ({
    skill,
    frequency,
    requiresRealExperience: /** @type {true} */ (true),
    justification: buildJustification(frequency, vacanciesSeen),
  }));
  const alreadyPresent = [...presentMap.values()];

  // --- сортировка: frequency DESC, тай-брейк name ASC (локаль-независимо) ---
  const sortByFreqThenName = (a, b) =>
    b.frequency - a.frequency || a.skill.localeCompare(b.skill, 'en', { sensitivity: 'base' });

  skillSuggestions.sort(sortByFreqThenName);
  alreadyPresent.sort(sortByFreqThenName);

  return {
    vacanciesSeen,
    relevantVacancies,
    skillSuggestions: skillSuggestions.slice(0, limit),
    alreadyPresent,
  };
}

/**
 * Короткая человекочитаемая (русская) сводка предложений для лога.
 * @param {*} suggestions - Результат buildResumeSuggestions.
 * @returns {string}
 */
export function summarizeSuggestions(suggestions) {
  if (!suggestions || typeof suggestions !== 'object') return 'Нет предложений.';

  const addCount = Array.isArray(suggestions.skillSuggestions)
    ? suggestions.skillSuggestions.length
    : 0;
  const presentCount = Array.isArray(suggestions.alreadyPresent)
    ? suggestions.alreadyPresent.length
    : 0;
  const seen = Number.isFinite(suggestions.vacanciesSeen) ? suggestions.vacanciesSeen : 0;

  return `Кандидатов на добавление: ${addCount}; уже в резюме: ${presentCount} (из ${seen} вакансий).`;
}
