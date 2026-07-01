// Локальное сопоставление типовых вопросов работодателя (переезд, командировки,
// занятость, формат, график, локация, гражданство, разрешение на работу и т.п.)
// с данными из структурированного preferences.txt кандидата.
// DeepSeek не вызывается — ответ берётся только из явно указанных предпочтений.
// Если ключ не найден → null (вызывающий сам решает: модель или NO_ANSWER).
// Никакой фабрикации: возвращается только то, что кандидат указал сам.

/**
 * Описание одной категории типового вопроса.
 * @typedef {{ id: string, matchesQuestion: (q: string) => boolean, matchKey: (key: string) => boolean }} Category
 */

/**
 * Единый список категорий — источник истины для findPreferenceCategory и answerFromPreferences.
 * Порядок важен: relocationAbroad проверяется до relocation.
 *
 * Внимание: не используем \b / \w рядом с кириллицей — они не работают в JS.
 * Все паттерны — простые подстроки с флагом /i.
 *
 * @type {Category[]}
 */
const CATEGORIES = [
  {
    id: 'relocationAbroad',
    matchesQuestion: (q) =>
      /за рубеж|за границ/i.test(q) && /переезд|релокац|переехать/i.test(q),
    matchKey: (key) => /за рубеж|за границ/i.test(key),
  },
  {
    id: 'relocation',
    matchesQuestion: (q) =>
      /переезд|переехать|релокац/i.test(q) && !/за рубеж|за границ/i.test(q),
    matchKey: (key) => /переезд|релокац/i.test(key) && !/за рубеж|за границ/i.test(key),
  },
  {
    id: 'travel',
    matchesQuestion: (q) => /командировк|разъезд/i.test(q),
    matchKey: (key) => /командировк|разъезд/i.test(key),
  },
  {
    id: 'employmentType',
    matchesQuestion: (q) => /занятост/i.test(q),
    matchKey: (key) => /занятост/i.test(key),
  },
  {
    id: 'workFormat',
    matchesQuestion: (q) => /формат работы|удал[её]нн|удал[её]нк|гибрид|в офисе|из офиса/i.test(q),
    matchKey: (key) => /формат/i.test(key),
  },
  {
    id: 'schedule',
    matchesQuestion: (q) => /график/i.test(q),
    matchKey: (key) => /график/i.test(key),
  },
  {
    id: 'location',
    matchesQuestion: (q) => /город проживан|ваш город|локац|местоположен/i.test(q),
    // «релокац» содержит «локац» — исключаем, чтобы ключ «Релокация» не утёк в ответ о городе.
    matchKey: (key) => /локац|город|местоположен/i.test(key) && !/релокац/i.test(key),
  },
  {
    id: 'citizenship',
    matchesQuestion: (q) => /гражданств/i.test(q),
    matchKey: (key) => /гражданств/i.test(key),
  },
  {
    id: 'workPermit',
    matchesQuestion: (q) => /разрешение на работу|право на работу|разрешение на трудоустройств/i.test(q),
    matchKey: (key) => /разрешение на работу|право на работу/i.test(key),
  },
  {
    id: 'offHoursContact',
    matchesQuestion: (q) => /нерабоч|в нерабочее время/i.test(q),
    matchKey: (key) => /нерабоч/i.test(key),
  },
];

/**
 * Разбирает текст preferences.txt в массив пар {key, value}.
 * Строки-комментарии (#) и пустые строки пропускаются.
 * Строки без «:» или с пустым ключом/значением пропускаются.
 * Не-строка на входе → [].
 *
 * @param {string} text
 * @returns {Array<{key: string, value: string}>}
 */
export function parsePreferences(text) {
  if (typeof text !== 'string') return [];
  const result = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\s*#/.test(line)) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key || !value) continue;
    result.push({ key, value });
  }
  return result;
}

/**
 * Определяет категорию вопроса работодателя по его тексту.
 * Возвращает id категории или null если вопрос не распознан.
 * Не-строка / пустая строка → null.
 *
 * @param {string} question
 * @returns {string|null}
 */
export function findPreferenceCategory(question) {
  if (typeof question !== 'string' || !question.trim()) return null;
  for (const cat of CATEGORIES) {
    if (cat.matchesQuestion(question)) return cat.id;
  }
  return null;
}

/**
 * Возвращает ответ на вопрос работодателя из предпочтений кандидата.
 * preferences — строка (будет разобрана) или уже разобранный массив {key, value}.
 * Если категория не найдена или ключ не найден в предпочтениях → null.
 * Никогда не бросает исключение на плохом входе.
 *
 * @param {string} question
 * @param {string|Array<{key: string, value: string}>} preferences
 * @returns {string|null}
 */
export function answerFromPreferences(question, preferences) {
  const catId = findPreferenceCategory(question);
  if (!catId) return null;

  const entries = Array.isArray(preferences)
    ? preferences
    : parsePreferences(typeof preferences === 'string' ? preferences : '');

  const cat = CATEGORIES.find((c) => c.id === catId);
  if (!cat) return null;

  const found = entries.find((e) => e && typeof e.key === 'string' && cat.matchKey(e.key));
  return found && typeof found.value === 'string' ? found.value : null;
}
