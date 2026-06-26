// Аккумулятор статистики одного прогона аккаунта.
// Чистый модуль (нет IO, нет сети). createRunSummary() создаёт независимый инстанс.
// Синглтон не нужен: каждый processAccount создаёт свой инстанс.

/**
 * Создаёт независимый аккумулятор статистики прогона по аккаунту.
 * @returns {{ record: (result: unknown) => void, snapshot: () => object, formatLine: () => string }}
 */
export function createRunSummary() {
  let viewed = 0;
  let applied = 0;
  let skipped = 0;
  let manual = 0;
  let alreadyApplied = 0;
  let dryRun = 0;
  let errors = 0;
  let quit = 0;
  let locallyScored = 0;
  let modelScored = 0;
  let cachedScored = 0;

  /**
   * Записывает один результат reviewVacancy (или { status: 'error' } из catch).
   * Всегда viewed += 1 (если result — объект с полем status).
   * Никогда не бросает.
   * @param {unknown} result
   */
  function record(result) {
    if (result === null || result === undefined || typeof result !== 'object' || Array.isArray(result)) {
      // Некорректный аргумент — пропускаем полностью (viewed не трогаем)
      return;
    }

    viewed += 1;

    const status = result.status;
    switch (status) {
      case 'clicked':
        applied += 1;
        break;
      case 'skipped':
        skipped += 1;
        break;
      case 'manual_needed':
        manual += 1;
        break;
      case 'already_applied':
        alreadyApplied += 1;
        break;
      case 'dry_run':
        dryRun += 1;
        break;
      case 'error':
        errors += 1;
        break;
      case 'quit':
        quit += 1;
        break;
      default:
        break;
    }

    const scoredBy = result.scoredBy;
    if (scoredBy === 'local') {
      locallyScored += 1;
    } else if (scoredBy === 'model') {
      modelScored += 1;
    } else if (scoredBy === 'cache') {
      cachedScored += 1;
    }
  }

  /**
   * Возвращает снимок текущих счётчиков.
   * @returns {object}
   */
  function snapshot() {
    return {
      viewed,
      applied,
      skipped,
      manual,
      alreadyApplied,
      dryRun,
      errors,
      quit,
      locallyScored,
      modelScored,
      cachedScored,
    };
  }

  /**
   * Возвращает короткую русскую строку-итог для вывода в конце прогона аккаунта.
   * @returns {string}
   */
  function formatLine() {
    return (
      `Итог: просмотрено ${viewed}, откликов ${applied}, пропущено ${skipped}, ` +
      `вручную ${manual}, уже откликались ${alreadyApplied}, dry-run ${dryRun}, ` +
      `ошибок ${errors} (скоринг: локально ${locallyScored}, модель ${modelScored}, кэш ${cachedScored}).`
    );
  }

  return { record, snapshot, formatLine };
}
