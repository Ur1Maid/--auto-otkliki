// Счётчик токенов и вызовов DeepSeek за прогон.
// Чистый модуль (нет IO, нет сети). createUsageCounter() создаёт независимый инстанс.
// Синглтон runUsageCounter — для реального прогона; тесты используют свои инстансы.

/**
 * Создаёт независимый аккумулятор статистики DeepSeek.
 * @returns {{ record: (usage: unknown) => void, snapshot: () => object, formatSummary: () => string, reset: () => void }}
 */
export function createUsageCounter() {
  let calls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let cacheHitTokens = 0;

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
   * Возвращает снимок текущих счётчиков.
   * @returns {{ calls: number, promptTokens: number, completionTokens: number, totalTokens: number, cacheHitTokens: number }}
   */
  function snapshot() {
    return {
      calls,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      cacheHitTokens,
    };
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
  }

  return { record, snapshot, formatSummary, reset };
}

// Синглтон для реального прогона. Тесты создают свои инстансы через createUsageCounter().
export const runUsageCounter = createUsageCounter();
