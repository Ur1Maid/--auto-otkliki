// Счётчик токенов и вызовов DeepSeek за прогон.
// Чистый модуль (нет IO, нет сети). createUsageCounter() создаёт независимый инстанс.
// Синглтон runUsageCounter — для реального прогона; тесты используют свои инстансы.

import { estimateCost } from './metrics.js';

/**
 * Создаёт независимый аккумулятор статистики DeepSeek.
 * @returns {{ record: (usage: unknown) => void, recordError: (status: number) => void, snapshot: () => object, liveSnapshot: (pricing?: object) => object, formatSummary: () => string, reset: () => void }}
 */
export function createUsageCounter() {
  let calls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let cacheHitTokens = 0;
  let apiErrors = 0;
  let balanceExhausted = false;

  /**
   * Записывает одну запись usage из ответа DeepSeek.
   * Всегда инкрементит calls.
   * Если usage — объект: суммирует токены; иначе только calls++.
   * Никогда не бросает.
   * @param {unknown} usage
   */
  function record(usage) {
    calls += 1;
    if (usage !== null && typeof usage === 'object' && !Array.isArray(usage)) {
      promptTokens += Number(usage.prompt_tokens) || 0;
      completionTokens += Number(usage.completion_tokens) || 0;
      cacheHitTokens += Number(usage.prompt_cache_hit_tokens) || 0;
    }
  }

  /**
   * Фиксирует НЕуспешный ответ API (для алертинга). HTTP 402 = «недостаточно баланса»
   * (см. deepseek.md) → выставляет липкий флаг balanceExhausted. Никогда не бросает.
   * @param {number} status — HTTP-статус (0 = сеть/таймаут)
   */
  function recordError(status) {
    apiErrors += 1;
    if (Number(status) === 402) balanceExhausted = true;
  }

  /**
   * Возвращает снимок текущих счётчиков.
   * @returns {{ calls: number, promptTokens: number, completionTokens: number, totalTokens: number, cacheHitTokens: number, apiErrors: number, balanceExhausted: boolean }}
   */
  function snapshot() {
    return {
      calls,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      cacheHitTokens,
      apiErrors,
      balanceExhausted,
    };
  }

  /**
   * Публичный снимок текущего накопителя ВО ВРЕМЯ прогона (для панели управления):
   * те же счётчики, что snapshot(), плюс оценка стоимости в USD через общий
   * estimateCost (единый источник цен — см. metrics.js). Не завершает прогон, не
   * мутирует состояние, никогда не бросает.
   * @param {{ inMissPerM?: number, inHitPerM?: number, outPerM?: number }} [pricing]
   * @returns {{ calls: number, promptTokens: number, completionTokens: number, totalTokens: number, cacheHitTokens: number, apiErrors: number, balanceExhausted: boolean, estimatedCostUsd: number }}
   */
  function liveSnapshot(pricing) {
    const snap = snapshot();
    return { ...snap, estimatedCostUsd: estimateCost(snap, pricing) };
  }

  /**
   * Возвращает короткую русскую строку-итог для вывода в конце прогона.
   * @returns {string}
   */
  function formatSummary() {
    const total = promptTokens + completionTokens;
    return `DeepSeek за прогон: вызовов ${calls}, вход ${promptTokens} токенов, выход ${completionTokens}, всего ${total} (из них cache-hit ${cacheHitTokens}).`;
  }

  /** Обнуляет все счётчики (для переиспользования инстанса). */
  function reset() {
    calls = 0;
    promptTokens = 0;
    completionTokens = 0;
    cacheHitTokens = 0;
    apiErrors = 0;
    balanceExhausted = false;
  }

  return { record, recordError, snapshot, liveSnapshot, formatSummary, reset };
}

// Синглтон для реального прогона. Тесты создают свои инстансы через createUsageCounter().
export const runUsageCounter = createUsageCounter();
