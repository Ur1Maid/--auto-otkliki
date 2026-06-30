// Чистый агрегатор счётчиков текущего прогона для панели «Сейчас» (M12.3).
// Без IO, сети, Date.now() — только проекция снимков в нужный формат.
//
// Счётчики автоматически «обнуляются» на новый запуск, потому что источник —
// свежий инстанс createRunSummary() (и соответствующий usageCounter) на каждый
// processAccount. Этот модуль просто читает готовые снимки, а не накапливает их.
//
// Использование:
//   import { buildRunCounters } from './runCounters.js';
//   const counters = buildRunCounters({ summary: runSummary.snapshot(), tokens: usageCounter.liveSnapshot() });

/**
 * Возвращает 0 если v — не конечное число, иначе возвращает v (не клампит отрицательные).
 * @param {unknown} v
 * @returns {number}
 */
function num(v) {
  return Number.isFinite(v) ? v : 0;
}

/**
 * Проецирует снимок прогона и снимок токенов в счётчики панели «Сейчас».
 *
 * @param {{ summary?: object|null, tokens?: object|null }} [opts]
 * @param {object|null} [opts.summary] — результат createRunSummary().snapshot():
 *   поля viewed, applied, skipped, manual, alreadyApplied, dryRun, errors, quit.
 *   Панели «Сейчас» нужны не все: quit и поля скоринга (locallyScored/modelScored/
 *   cachedScored) намеренно не проецируются.
 * @param {object|null} [opts.tokens] — результат createUsageCounter().snapshot() / liveSnapshot():
 *   поля calls, promptTokens, completionTokens, totalTokens, cacheHitTokens, estimatedCostUsd.
 * @returns {{
 *   viewed: number,
 *   sent: number,
 *   skipped: number,
 *   manual: number,
 *   alreadyApplied: number,
 *   errors: number,
 *   tokens: {
 *     calls: number,
 *     promptTokens: number,
 *     completionTokens: number,
 *     totalTokens: number,
 *     cacheHitTokens: number,
 *     estimatedCostUsd: number,
 *   },
 * }}
 */
export function buildRunCounters({ summary, tokens } = {}) {
  // summary: принимаем только plain-объект (не null, не массив, не примитив)
  const hasSummary = summary !== null && summary !== undefined &&
    typeof summary === 'object' && !Array.isArray(summary);

  const viewed        = hasSummary ? num(summary.viewed)        : 0;
  const applied       = hasSummary ? num(summary.applied)       : 0;
  const dryRun        = hasSummary ? num(summary.dryRun)        : 0;
  const skipped       = hasSummary ? num(summary.skipped)       : 0;
  const manual        = hasSummary ? num(summary.manual)        : 0;
  const alreadyApplied = hasSummary ? num(summary.alreadyApplied) : 0;
  const errors        = hasSummary ? num(summary.errors)        : 0;

  // sent = applied + dryRun («откликнулся бы» в dry-run тоже считается)
  // Зеркалит логику review.js: appliedSoFar = applied + dryRun
  const sent = applied + dryRun;

  // tokens: принимаем только plain-объект
  const hasTokens = tokens !== null && tokens !== undefined &&
    typeof tokens === 'object' && !Array.isArray(tokens);

  const calls             = hasTokens ? num(tokens.calls)             : 0;
  const promptTokens      = hasTokens ? num(tokens.promptTokens)      : 0;
  const completionTokens  = hasTokens ? num(tokens.completionTokens)  : 0;
  const cacheHitTokens    = hasTokens ? num(tokens.cacheHitTokens)    : 0;

  // totalTokens всегда пересчитывается — не доверяем входному значению
  const totalTokens = promptTokens + completionTokens;

  // estimatedCostUsd пробрасываем как есть, если конечное число; иначе 0
  // Ценообразование живёт в metrics.estimateCost / usageCounter.liveSnapshot — здесь не считаем
  const estimatedCostUsd = hasTokens && Number.isFinite(tokens.estimatedCostUsd)
    ? tokens.estimatedCostUsd
    : 0;

  return {
    viewed,
    sent,
    skipped,
    manual,
    alreadyApplied,
    errors,
    tokens: {
      calls,
      promptTokens,
      completionTokens,
      totalTokens,
      cacheHitTokens,
      estimatedCostUsd,
    },
  };
}
