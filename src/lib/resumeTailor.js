// Чистые функции применения additive-правок к тексту резюме (M6.2).
// Без IO, сети, вызовов модели, Date.now() — только строковые преобразования.
//
// HONESTY-ИНВАРИАНТ: эти функции НИКОГДА не добавляют навыки, которых нет
// во входном массиве approvedSkills (одобренном человеком/процессом).
// ADDITIVE-ONLY: существующие строки резюме НИКОГДА не удаляются/изменяются.

import { normalizeText, extractResumeKeywords } from './knowledge.js';

// Лимит изменённых строк по умолчанию (addedLines + removedLines).
export const DEFAULT_MAX_CHANGED_LINES = 8;

// Минимальный порог сходства по коэффициенту Сёренсена–Дайса по строкам.
export const DEFAULT_MIN_SIMILARITY = 0.85;

// Максимум новых навыков за один вызов applyAdditiveSkills.
export const DEFAULT_MAX_NEW_SKILLS = 8;

// ─── внутренние хелперы ───────────────────────────────────────────────────────

/**
 * Нормализует числовой лимит к целому числу >= 0.
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizeNonNegLimit(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

/**
 * Строит мультимножество строк: Map<строка, число вхождений>.
 * @param {string[]} lines
 * @returns {Map<string, number>}
 */
function multiset(lines) {
  const map = new Map();
  for (const line of lines) {
    map.set(line, (map.get(line) ?? 0) + 1);
  }
  return map;
}

/**
 * Проверяет, присутствует ли навык в тексте резюме как отдельное слово/лексема.
 * Аналог isSkillInResumeText из resumeSuggestions.js.
 * При сомнении считаем навык присутствующим (безопасное направление ошибки для honesty).
 *
 * @param {string} normSkill - Нормализованный навык (normalizeText).
 * @param {string} normResume - Нормализованный текст резюме (normalizeText).
 * @returns {boolean}
 */
function isSkillPresentInText(normSkill, normResume) {
  if (!normSkill || !normResume) return false;
  const escaped = normSkill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-zа-яё0-9])${escaped}([^a-zа-яё0-9]|$)`, 'i').test(normResume);
}

// ─── экспортируемые функции ───────────────────────────────────────────────────

/**
 * Вычисляет расхождение между исходным и изменённым текстами — построчно,
 * с учётом мультимножеств (дублирующиеся строки считаются корректно).
 *
 * Guard: не-строки трактуются как ''.
 *
 * Коэффициент сходства — Сёренсен–Дайс по мультимножеству строк:
 *   similarity = 2 * common / (origCount + modCount)
 * где common = сумма min-вхождений каждой строки.
 * При origCount + modCount === 0 → similarity = 1 (оба текста пусты).
 *
 * @param {string} original
 * @param {string} modified
 * @returns {{
 *   originalLines: number,
 *   modifiedLines: number,
 *   addedLines: number,
 *   removedLines: number,
 *   changedLines: number,
 *   similarity: number,
 * }}
 */
export function computeDivergence(original, modified) {
  const origStr = typeof original === 'string' ? original : '';
  const modStr = typeof modified === 'string' ? modified : '';

  const origLines = origStr.split('\n');
  const modLines = modStr.split('\n');

  const origSet = multiset(origLines);
  const modSet = multiset(modLines);

  const origCount = origLines.length;
  const modCount = modLines.length;

  // common = сумма min-вхождений (строки, присутствующие в обоих)
  let common = 0;
  for (const [line, count] of origSet) {
    const inMod = modSet.get(line) ?? 0;
    common += Math.min(count, inMod);
  }

  // addedLines: строки в modified, которых не хватает в original
  let addedLines = 0;
  for (const [line, count] of modSet) {
    const inOrig = origSet.get(line) ?? 0;
    if (count > inOrig) addedLines += count - inOrig;
  }

  // removedLines: строки в original, которых не хватает в modified
  let removedLines = 0;
  for (const [line, count] of origSet) {
    const inMod = modSet.get(line) ?? 0;
    if (count > inMod) removedLines += count - inMod;
  }

  const changedLines = addedLines + removedLines;

  const denominator = origCount + modCount;
  const similarity = denominator === 0 ? 1 : (2 * common) / denominator;

  return {
    originalLines: origCount,
    modifiedLines: modCount,
    addedLines,
    removedLines,
    changedLines,
    similarity,
  };
}

/**
 * Проверяет, укладывается ли расхождение в разрешённые лимиты.
 *
 * @param {object} divergence - Результат computeDivergence.
 * @param {{ maxChangedLines?: number, minSimilarity?: number }} [opts]
 * @returns {boolean}
 */
export function withinDivergenceLimit(divergence, opts = {}) {
  if (!divergence || typeof divergence !== 'object') return false;

  const maxChanged = normalizeNonNegLimit(opts.maxChangedLines, DEFAULT_MAX_CHANGED_LINES);

  // minSimilarity: если вне [0,1] — используем дефолт
  let minSim = DEFAULT_MIN_SIMILARITY;
  if (Number.isFinite(opts.minSimilarity) && opts.minSimilarity >= 0 && opts.minSimilarity <= 1) {
    minSim = opts.minSimilarity;
  }

  return divergence.changedLines <= maxChanged && divergence.similarity >= minSim;
}

/**
 * Применяет ADDITIVE-правку: добавляет одобренные навыки к тексту резюме.
 *
 * HONESTY: добавляются ТОЛЬКО навыки из явного входа approvedSkills.
 * ADDITIVE-ONLY: исходные строки резюме НЕ удаляются и НЕ изменяются.
 *
 * Если approvedSkills пуст или все навыки уже присутствуют в резюме —
 * текст возвращается БАЙТ-В-БАЙТ без изменений (даже без добавления newline).
 *
 * @param {string} resumeText - Текущий текст резюме.
 * @param {string[]} approvedSkills - Одобренные навыки для добавления.
 * @param {{ maxNewSkills?: number }} [opts]
 * @returns {{
 *   text: string,
 *   addedSkills: string[],
 *   skipped: Array<{ skill: string, reason: 'empty'|'duplicate'|'already_present'|'over_limit' }>,
 * }}
 */
export function applyAdditiveSkills(resumeText, approvedSkills, opts = {}) {
  const safeResume = typeof resumeText === 'string' ? resumeText : '';
  const safeSkills = Array.isArray(approvedSkills) ? approvedSkills : [];
  const maxNew = normalizeNonNegLimit(opts.maxNewSkills, DEFAULT_MAX_NEW_SKILLS);

  const skipped = [];

  // Множество навыков, уже присутствующих в резюме.
  // Две проверки намеренно: extractResumeKeywords ловит whitelist-навыки с
  // техно-границами (+#.-, knowledge.js), isSkillPresentInText — любые навыки
  // вне whitelist по обычным границам слова. Оба дают «при сомнении=присутствует»
  // (skip-on-doubt) — безопасное для honesty направление ошибки.
  const presentSet = new Set(extractResumeKeywords(safeResume).map(normalizeText));
  const normResume = normalizeText(safeResume);

  const seenNorm = new Set(); // дедуп входного approvedSkills
  const toAdd = [];           // навыки к добавлению (в исходном написании)

  for (const skill of safeSkills) {
    if (typeof skill !== 'string' || skill.trim() === '') {
      skipped.push({ skill: String(skill), reason: 'empty' });
      continue;
    }

    const normSkill = normalizeText(skill);

    // дедуп внутри approvedSkills
    if (seenNorm.has(normSkill)) {
      skipped.push({ skill, reason: 'duplicate' });
      continue;
    }
    seenNorm.add(normSkill);

    // пропуск уже присутствующих
    if (presentSet.has(normSkill) || isSkillPresentInText(normSkill, normResume)) {
      skipped.push({ skill, reason: 'already_present' });
      continue;
    }

    toAdd.push(skill);
  }

  // обрезка по maxNewSkills
  if (toAdd.length > maxNew) {
    const over = toAdd.splice(maxNew);
    for (const skill of over) {
      skipped.push({ skill, reason: 'over_limit' });
    }
  }

  // нечего добавлять — текст без изменений
  if (toAdd.length === 0) {
    return { text: safeResume, addedSkills: [], skipped };
  }

  // Компактный блок навыков: одна строка «- Навыки: a, b, c» — минимальная дивергенция
  const skillsLine = `- Навыки: ${toAdd.join(', ')}`;

  // Сохраняем доминирующий EOL резюме (CRLF vs LF), чтобы не вносить смешанные
  // переводы строк в реальный resume.md при записи (M6.3).
  const eol = safeResume.includes('\r\n') ? '\r\n' : '\n';

  // Ищем существующий заголовок навыков ПОСТРОЧНО.
  // Построчная вставка (split/join по EOL) гарантирует, что каждая исходная строка
  // сохраняется как отдельный элемент — additive-only без риска искажения строки
  // заголовка (многословного «## Ключевые навыки и технологии» или в конце файла).
  // \b не работает с кириллицей в JavaScript, поэтому используем (\s|$).
  const headingLineRegex = /^#{1,6}\s*(навыки|ключевые навыки|skills)(\s|$)/i;
  const lines = safeResume.split(eol);
  const headingIdx = lines.findIndex((line) => headingLineRegex.test(line));

  let newText;
  if (headingIdx !== -1) {
    // Вставляем новую строку отдельным элементом сразу ПОСЛЕ строки-заголовка.
    const next = [
      ...lines.slice(0, headingIdx + 1),
      skillsLine,
      ...lines.slice(headingIdx + 1),
    ];
    newText = next.join(eol);
  } else {
    // Добавляем новый блок в конец, отделяя одной пустой строкой.
    const sep = safeResume.endsWith(eol) ? eol : eol + eol;
    newText = safeResume + sep + '## Дополнительные навыки' + eol + skillsLine + eol;
  }

  return { text: newText, addedSkills: toAdd, skipped };
}

/**
 * Оркестрирует применение одобренных навыков с проверкой лимита дивергенции.
 * Если лимит превышен — возвращает исходный текст (правка откатывается).
 *
 * @param {string} resumeText - Текущий текст резюме.
 * @param {{
 *   approvedSkills?: string[],
 *   limits?: { maxChangedLines?: number, minSimilarity?: number, maxNewSkills?: number },
 * }} [opts]
 * @returns {{
 *   original: string,
 *   tailored: string,
 *   applied: boolean,
 *   reason?: string,
 *   divergence: object,
 *   addedSkills: string[],
 *   skipped: Array<{ skill: string, reason: string }>,
 * }}
 */
export function tailorResume(resumeText, opts = {}) {
  const safeResume = typeof resumeText === 'string' ? resumeText : '';
  const { approvedSkills, limits } = (opts !== null && typeof opts === 'object') ? opts : {};

  const applied = applyAdditiveSkills(safeResume, approvedSkills, limits);
  const divergence = computeDivergence(safeResume, applied.text);
  const withinLimit = withinDivergenceLimit(divergence, limits ?? {});

  if (!withinLimit) {
    return {
      original: safeResume,
      tailored: safeResume,
      applied: false,
      reason: 'divergence_limit_exceeded',
      divergence,
      addedSkills: [],
      skipped: applied.skipped,
    };
  }

  return {
    original: safeResume,
    tailored: applied.text,
    applied: true,
    divergence,
    addedSkills: applied.addedSkills,
    skipped: applied.skipped,
  };
}

/**
 * Генерирует имя файла для timestamped-бэкапа в формате UTC.
 * Формат: `<baseName>.<YYYYMMDD-HHMMSS>.bak`
 *
 * @param {string} baseName - Базовое имя файла (напр. 'resume.md').
 * @param {Date} date - Явный Date (НЕ Date.now()); невалидный Date → TypeError.
 * @returns {string}
 * @throws {TypeError} если date не является Date или является Invalid Date.
 */
export function backupFileName(baseName, date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new TypeError('backupFileName: ожидается валидный Date');
  }

  const pad2 = (n) => String(n).padStart(2, '0');

  const Y = date.getUTCFullYear();
  const M = pad2(date.getUTCMonth() + 1);
  const D = pad2(date.getUTCDate());
  const h = pad2(date.getUTCHours());
  const m = pad2(date.getUTCMinutes());
  const s = pad2(date.getUTCSeconds());

  return `${baseName}.${Y}${M}${D}-${h}${m}${s}.bak`;
}
