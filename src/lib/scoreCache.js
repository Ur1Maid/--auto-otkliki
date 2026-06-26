// Кэш результатов скоринга вакансий: score-cache.json в data/.
// Ключ = нормализованный URL вакансии + хэш резюме → { score, reason }.
// В кэш НЕ попадают: текст резюме, зарплата, ключи API, PII.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { normalizeVacancyUrl } from './urls.js';

/**
 * Возвращает 16-символьный hex-хэш строки резюме.
 * Детерминирован, чистый. Не-строка → хэш от ''.
 * @param {string} resumeText
 * @returns {string}
 */
export function hashResume(resumeText) {
  const text = typeof resumeText === 'string' ? resumeText : '';
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Строит ключ кэша для пары вакансия+резюме.
 * Возвращает '' если URL не является URL вакансии (такие не кэшируем).
 * @param {string} vacancyUrl
 * @param {string} resumeHash — результат hashResume()
 * @returns {string}
 */
export function cacheKey(vacancyUrl, resumeHash) {
  let normalized = '';
  try {
    normalized = normalizeVacancyUrl(vacancyUrl);
  } catch {
    return ''; // битый/не-строковый URL не кэшируем (хелпер не должен бросать)
  }
  if (!normalized) return '';
  return `${normalized}|${resumeHash}`;
}

/**
 * Читает запись из кэша по ключу.
 * Возвращает { score, reason } или null при промахе / плохом ключе / порченом значении.
 * Score клампится 0..100 при чтении.
 * @param {object|null} cache
 * @param {string} key
 * @returns {{ score: number, reason: string }|null}
 */
export function getCached(cache, key) {
  if (!key || !cache || typeof cache !== 'object') return null;
  const entry = cache[key];
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.score !== 'number' || !Number.isFinite(entry.score)) return null;
  const score = Math.max(0, Math.min(100, entry.score));
  const reason = typeof entry.reason === 'string' ? entry.reason : '';
  return { score, reason };
}

/**
 * Записывает пару ключ → { score, reason } в кэш-объект (мутирует).
 * Пустой ключ или невалидный score — no-op.
 * Score клампится 0..100 при записи.
 * @param {object} cache
 * @param {string} key
 * @param {{ score: number, reason?: string }} value
 * @returns {object} — тот же cache
 */
export function setCached(cache, key, value) {
  if (!key) return cache;
  if (!value || typeof value.score !== 'number' || !Number.isFinite(value.score)) return cache;
  const score = Math.max(0, Math.min(100, value.score));
  const reason = typeof value.reason === 'string' ? value.reason : '';
  cache[key] = { score, reason };
  return cache;
}

/**
 * Загружает кэш из JSON-файла.
 * При отсутствии файла или битом JSON возвращает {}.
 * Никогда не бросает.
 * @param {string} filePath
 * @returns {Promise<object>}
 */
export async function loadCache(filePath) {
  try {
    const text = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return {};
  } catch {
    return {};
  }
}

/**
 * Сохраняет кэш в JSON-файл (компактный, без отступов).
 * Ошибки записи заглушаются — не роняем прогон.
 * @param {string} filePath
 * @param {object} cache
 * @returns {Promise<void>}
 */
export async function saveCache(filePath, cache) {
  // Сливаем с актуальным содержимым на диске перед записью: свежие записи из памяти
  // побеждают, но ключи, дописанные параллельным аккаунтом между нашими load и save,
  // не теряются (записи неймспейснуты по resumeHash, конфликта содержимого нет).
  const onDisk = await loadCache(filePath);
  const merged = { ...onDisk, ...cache };
  await writeFile(filePath, JSON.stringify(merged, null, 0), 'utf8').catch(() => {});
}
