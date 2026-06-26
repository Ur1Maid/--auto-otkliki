// Чистая приоритизация вакансий из поиска hh.ru.
// БЕЗ фильтрации: ни одна вакансия не отсекается — меняется только порядок отклика.
// «Удалёнка» (метка data-qa="vacancy-label-work-schedule-remote") идёт первой,
// остальные — следом. Внутри каждой группы сохраняется исходный DOM-порядок.

import { normalizeVacancyUrl } from './urls.js';

/** Безопасная нормализация: любой сбой URL → '' (вакансия молча пропускается). */
function safeNormalize(url) {
  try {
    return normalizeVacancyUrl(url || '');
  } catch {
    return '';
  }
}

/**
 * Упорядочивает вакансии: сначала удалёнка, потом остальные — без отсева.
 * Нормализует и дедуплицирует URL до канона /vacancy/<id>. Если один и тот же
 * URL встречается и как remote, и как не-remote, он считается remote (OR по
 * вхождениям) и попадает в приоритетную группу. Порядок внутри группы — по
 * первому появлению (стабильно).
 *
 * @param {Array<{ url?: string, remote?: boolean }>} items — сырые карточки из DOM
 * @returns {string[]} канонические URL: сначала удалёнка, затем остальные
 */
export function prioritizeRemoteFirst(items) {
  const order = [];               // канонические URL в порядке первого появления
  const remoteByUrl = new Map();  // url → boolean (OR по вхождениям)

  for (const item of Array.isArray(items) ? items : []) {
    const url = safeNormalize(item?.url);
    if (!url) continue;
    if (!remoteByUrl.has(url)) {
      order.push(url);
      remoteByUrl.set(url, item?.remote === true);
    } else if (item?.remote === true) {
      remoteByUrl.set(url, true);
    }
  }

  const remote = order.filter((url) => remoteByUrl.get(url) === true);
  const rest = order.filter((url) => remoteByUrl.get(url) !== true);
  return [...remote, ...rest];
}

/**
 * Паттерны «удалённого формата» в тексте описания вакансии (не в фильтрах выдачи).
 * Нацелены на формулировки о работе, чтобы не ловить «удалённость от метро» и т.п.
 */
const REMOTE_TEXT_PATTERNS = [
  /удал[её]нн?(?:ая|ый|ую|ой|о|ом)?\s*(?:работ|формат|занятост|сотрудничеств|режим|график)/i,
  /удал[её]нк/i,                         // «удалёнка», «на удалёнке» (\b не работает с кириллицей без /u)
  /можно\s*удал[её]нно/i,
  /формат\s*работы[:\s]*[^.]{0,20}удал[её]нн/i,
  /дистанционн(?:ая|ый|ую|ой|о|ом)?\s*(?:работ|формат|занятост|режим)/i,
  /\bremote\b/i,
  /work\s*from\s*home/i,
  /\bwfh\b/i,
];

/**
 * Определяет, упомянут ли удалённый формат в тексте описания вакансии.
 * Дополняет метку из фильтров выдачи (некоторые вакансии не помечены, но
 * пишут про удалёнку в описании).
 *
 * @param {string} text — текст описания вакансии
 * @returns {boolean}
 */
export function looksRemoteInText(text) {
  const safe = typeof text === 'string' ? text : '';
  if (!safe) return false;
  return REMOTE_TEXT_PATTERNS.some((re) => re.test(safe));
}
