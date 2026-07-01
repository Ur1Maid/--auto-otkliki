// Плашка hh.ru «Подходит по навыкам на N%» из карточки выдачи (SERP).
//
// Верифицировано на живом SERP-HTML (2026-07-01): у плашки НЕТ стабильного data-qa —
// только хешированный класс `magritte-tag__label___…`, поэтому единственный устойчивый
// «якорь» — её ТЕКСТ. Между словами в разметке стоят неразрывные пробелы (&nbsp; =
//  ), поэтому регэксп терпим к любому пробелу (`\s` в JS матчит  ). Кириллица
// без `\b`/`\w` (урок M11.6 — границы слов на кириллице ненадёжны).
//
// Использование ограничено инвариантом M3.2: локальный сигнал только ОТКЛОНЯЕТ и меняет
// ПОРЯДОК; он НИКОГДА не пропускает вакансию к отклику без модели.

// «Подходит по навыкам на N%» — пробелы (в т.ч.  ) между словами и перед %.
const MATCH_BADGE_RE = /Подходит\s+по\s+навыкам\s+на\s*(\d+)\s*%/i;

/** Порог «уверенного локального reject» по плашке (в процентах). Консервативный. */
export const DEFAULT_MATCH_REJECT_THRESHOLD = 20;

/**
 * Извлекает процент совпадения из текста карточки/плашки.
 * @param {string} text — текст карточки или самой плашки
 * @returns {number|null} 0..100 или null, если плашки нет / вход не строка
 */
export function parseMatchPercent(text) {
  const safe = typeof text === 'string' ? text : '';
  if (!safe) return null;
  const m = safe.match(MATCH_BADGE_RE);
  if (!m) return null;
  const pct = Number(m[1]);
  if (!Number.isFinite(pct)) return null;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * Уверенный ли это локальный reject по плашке совпадения.
 *
 * Возвращает true ТОЛЬКО когда процент известен и строго ниже порога. Отсутствие
 * плашки (`null`) → false: без сигнала не режем (консервативно — не теряем вакансию).
 * Это REJECT-предикат (пропустить дорогой скоринг у заведомо неподходящей), НЕ
 * пропуск-к-отклику: он лишь ОТКЛОНЯЕТ, поэтому не нарушает honesty/safety-инвариант M3.2.
 *
 * @param {number|null} pct — процент из parseMatchPercent
 * @param {number} [threshold=DEFAULT_MATCH_REJECT_THRESHOLD]
 * @returns {boolean}
 */
export function isConfidentMatchReject(pct, threshold = DEFAULT_MATCH_REJECT_THRESHOLD) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return false;
  const t = Number.isFinite(threshold) ? threshold : DEFAULT_MATCH_REJECT_THRESHOLD;
  return pct < t;
}
