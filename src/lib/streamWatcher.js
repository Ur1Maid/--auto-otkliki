/**
 * src/lib/streamWatcher.js — чистая логика детекта изменений файлов для SSE-стрима панели (M13.3).
 *
 * Зачем: dashboard.js раз в ~400 мс проверяет mtime файлов logs/status/*.json и
 * logs/resources.jsonl; при изменении пушит свежий снимок «Сейчас» подписчикам EventSource.
 * Здесь — только ЧИСТОЕ сравнение сигнатур mtime (без IO/таймеров), чтобы покрыть тестом.
 *
 * Детерминирован, не бросает на мусоре (как остальные lib-модули).
 */

/** Конечное неотрицательное число (mtimeMs валиден)? */
function isFiniteMs(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/**
 * Строит стабильную сигнатуру по списку файлов с mtime. Порядок входа не важен
 * (сортируем по имени); записи без имени/валидного mtime (файл отсутствует или stat
 * не прочитался) пропускаются — поэтому появление/исчезновение файла меняет сигнатуру.
 *
 * @param {Array<{name?: string, mtimeMs?: number}>} entries
 * @returns {string}
 */
export function buildMtimeSignature(entries) {
  if (!Array.isArray(entries)) return '';
  const parts = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const name = typeof e.name === 'string' ? e.name : '';
    if (!name) continue;
    if (!isFiniteMs(e.mtimeMs)) continue;
    parts.push(`${name}:${e.mtimeMs}`);
  }
  parts.sort();
  return parts.join('|');
}

/**
 * Сигнатура изменилась? Любое расхождение строк = изменение. Первая проверка
 * (prev null/undefined) считается изменением — чтобы стрим отправил первый снимок.
 *
 * @param {string|null|undefined} prev
 * @param {string} curr
 * @returns {boolean}
 */
export function signatureChanged(prev, curr) {
  if (prev == null) return true;
  return String(prev) !== String(curr);
}
