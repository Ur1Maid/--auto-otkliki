// Дедуп репостов вакансий из выдачи hh.ru по (заголовок + компания).
//
// Верифицировано на живом SERP-HTML (2026-07-01): компания извлекается из
// `[data-qa="vacancy-serp__vacancy-employer-text"]` (присутствует в каждой карточке).
// Кэш скоринга M3.6 уже дедуплицирует по vacancyId+resumeHash — этот слой добивает
// РЕПОСТЫ: одна и та же вакансия, перевыложенная под РАЗНЫМИ id/url, но с одинаковым
// заголовком и компанией.
//
// Консервативно: пустая/отсутствующая компания → НЕ схлопываем (одинаковый заголовок
// у разных работодателей — например «DevOps Engineer» — это разные вакансии). Схлопывание
// только УБИРАЕТ дубль (никогда не создаёт отклик), поэтому безопасно под инвариантами.

// Разделитель ключа — NUL: не встречается в нормализованном тексте, поэтому пары
// («abc»,«d») и («ab»,«cd») не коллизируют.
const KEY_SEP = String.fromCharCode(0);

/** Нормализация ключа: строка → trim + lower + схлопнутые пробелы; не строка → ''. */
function norm(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

/**
 * Убирает репосты, сохраняя ПЕРВОЕ вхождение (порядок входа не меняется).
 * Карточка схлопывается только если у неё непустые И заголовок, И компания, и такая
 * пара уже встречалась. Битые элементы (не объект) пропускаются.
 *
 * @param {Array<{ url?: string, remote?: boolean, matchPercent?: number|null, company?: string, title?: string }>} cards
 * @returns {Array<object>} тот же массив без репостов-дублей (стабильный порядок)
 */
export function dedupeReposts(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const seen = new Set();
  const out = [];
  for (const card of list) {
    if (!card || typeof card !== 'object') continue;
    const company = norm(card.company);
    const title = norm(card.title);
    if (company && title) {
      const key = title + KEY_SEP + company;
      if (seen.has(key)) continue; // репост — пропускаем
      seen.add(key);
    }
    out.push(card);
  }
  return out;
}
