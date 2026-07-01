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

/** Число совпадения (плашка M3.3) → 0..100 или null, если сигнала нет. */
function toMatch(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Упорядочивает вакансии: сначала удалёнка, потом остальные — без отсева.
 * Нормализует и дедуплицирует URL до канона /vacancy/<id>. Если один и тот же
 * URL встречается и как remote, и как не-remote, он считается remote (OR по
 * вхождениям) и попадает в приоритетную группу.
 *
 * Внутри каждой группы (удалёнка / остальные) — по УБЫВАНИЮ плашки совпадения
 * hh.ru «Подходит по навыкам на N%» (M3.3, поле `matchPercent`): выше совпадение —
 * раньше отклик. Карточки без плашки (`null`) идут в конец группы. При равном
 * проценте (и у всех без плашки) сохраняется исходный DOM-порядок (стабильно).
 * Это только ПОРЯДОК — ни одна вакансия не отсекается (инвариант M3.1 сохранён).
 *
 * @param {Array<{ url?: string, remote?: boolean, matchPercent?: number|null }>} items
 * @returns {string[]} канонические URL: удалёнка (по match desc) → остальные (по match desc)
 */
export function prioritizeRemoteFirst(items) {
  const order = [];         // канонические URL в порядке первого появления
  const info = new Map();   // url → { remote:boolean, match:number|null }

  for (const item of Array.isArray(items) ? items : []) {
    const url = safeNormalize(item?.url);
    if (!url) continue;
    const match = toMatch(item?.matchPercent);
    if (!info.has(url)) {
      order.push(url);
      info.set(url, { remote: item?.remote === true, match });
    } else {
      const cur = info.get(url);
      if (item?.remote === true) cur.remote = true;
      if (match != null && (cur.match == null || match > cur.match)) cur.match = match;
    }
  }

  const idx = new Map(order.map((url, i) => [url, i])); // индекс появления — для стабильности
  const byPriority = (a, b) => {
    const ia = info.get(a);
    const ib = info.get(b);
    if (ia.remote !== ib.remote) return ia.remote ? -1 : 1;      // удалёнка вперёд
    if (ia.match == null && ib.match != null) return 1;          // без плашки — в конец группы
    if (ia.match != null && ib.match == null) return -1;
    if (ia.match != null && ib.match != null && ia.match !== ib.match) return ib.match - ia.match; // выше match раньше
    return idx.get(a) - idx.get(b);                              // равные — по DOM-порядку
  };
  return [...order].sort(byPriority);
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
