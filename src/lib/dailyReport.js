// Чистый агрегатор дневной статистики для hh-auto-otkliki (M9.2).
// Без IO, сети, Date.now() — только аккумуляция данных. IO (запись в logs/daily-*.json)
// делает вызывающий код (демон), этот модуль только собирает и форматирует данные.
//
// Использование:
//   const report = createDailyReport();
//   report.recordAccountRun('acc1', runSummary.snapshot());
//   report.recordTokens(usageCounter.snapshot());
//   const obj = report.snapshot(new Date());
//   // вызывающий: fs.writeFile(`logs/${dailyReportFileName(new Date())}`, JSON.stringify(obj))

/**
 * Возвращает имя файла дневного отчёта по UTC-компонентам переданного Date.
 * Формат: daily-<YYYY-MM-DD>.json (с нулевым дополнением месяца и дня).
 *
 * @param {Date} date — валидный Date-объект
 * @returns {string} например 'daily-2026-06-26.json'
 * @throws {TypeError} если date не является Date или является Invalid Date
 */
export function dailyReportFileName(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new TypeError('dailyReportFileName: ожидается валидный Date');
  }
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `daily-${yyyy}-${mm}-${dd}.json`;
}

/**
 * Создаёт независимый аккумулятор дневной статистики.
 *
 * Методы record* никогда не бросают на мусорном входе (молча игнорируют).
 * snapshot() возвращает plain-объект; formatLine() — короткую русскую строку-итог.
 *
 * @returns {{
 *   recordAccountRun: (accountName: string, snapshot: object) => void,
 *   recordMessages: (stats?: object) => void,
 *   recordResumeEdit: (stats?: object) => void,
 *   recordTokens: (usageSnapshot: object) => void,
 *   snapshot: (date?: Date) => object,
 *   formatLine: () => string,
 * }}
 */
export function createDailyReport() {
  // --- Applications (из createRunSummary().snapshot()) ---
  let viewed = 0;
  let applied = 0;
  let skipped = 0;
  let manual = 0;
  let alreadyApplied = 0;
  let dryRun = 0;
  let errors = 0;

  // Множество уникальных имён аккаунтов
  const accountNames = new Set();

  // --- Messages ---
  let msgProcessed = 0;
  let msgReplied = 0;
  let msgSkippedNoReply = 0;
  let msgManual = 0;

  // --- Resume edits ---
  let resumeEditsApplied = 0;
  let resumeEditsSkipped = 0;
  let addedSkillsTotal = 0;

  // --- Tokens (из createUsageCounter().snapshot()) ---
  // Поля совпадают с usageCounter.js: calls, promptTokens, completionTokens, cacheHitTokens
  let tokPrompt = 0;
  let tokCompletion = 0;
  let tokCacheHit = 0;
  let tokCalls = 0;
  let apiErrors = 0;
  let balanceExhausted = false;

  /**
   * Аккумулирует один per-account прогон в дневные тоталы.
   * accountName не непустая строка → игнор. snapshot не объект → игнор.
   *
   * @param {string} accountName
   * @param {object} snap — результат createRunSummary().snapshot()
   */
  function recordAccountRun(accountName, snap) {
    if (typeof accountName !== 'string' || accountName.trim() === '') return;
    if (snap === null || typeof snap !== 'object' || Array.isArray(snap)) return;

    accountNames.add(accountName);

    viewed += Number(snap.viewed) || 0;
    applied += Number(snap.applied) || 0;
    skipped += Number(snap.skipped) || 0;
    manual += Number(snap.manual) || 0;
    alreadyApplied += Number(snap.alreadyApplied) || 0;
    dryRun += Number(snap.dryRun) || 0;
    errors += Number(snap.errors) || 0;
  }

  /**
   * Аккумулирует обработку сообщений за итерацию поллинга.
   * Аргумент не объект → игнор. Нечисловые поля → 0.
   *
   * @param {{ processed?: number, replied?: number, skippedNoReply?: number, manual?: number }} [stats]
   */
  function recordMessages(stats = {}) {
    if (stats === null || typeof stats !== 'object' || Array.isArray(stats)) return;

    msgProcessed += Number(stats.processed) || 0;
    msgReplied += Number(stats.replied) || 0;
    msgSkippedNoReply += Number(stats.skippedNoReply) || 0;
    msgManual += Number(stats.manual) || 0;
  }

  /**
   * Аккумулирует событие правки резюме.
   * applied===true → resumeEditsApplied += 1; иначе resumeEditsSkipped += 1.
   * Аргумент не объект → игнор.
   *
   * @param {{ account?: string, applied?: boolean, addedSkillsCount?: number }} [stats]
   */
  function recordResumeEdit(stats = {}) {
    if (stats === null || typeof stats !== 'object' || Array.isArray(stats)) return;

    if (stats.applied === true) {
      resumeEditsApplied += 1;
    } else {
      resumeEditsSkipped += 1;
    }
    addedSkillsTotal += Number(stats.addedSkillsCount) || 0;
  }

  /**
   * Аккумулирует токены за день.
   * Имена полей совпадают с createUsageCounter().snapshot():
   *   calls, promptTokens, completionTokens, cacheHitTokens.
   * usageSnapshot не объект → игнор.
   *
   * @param {object} usageSnapshot — результат createUsageCounter().snapshot()
   */
  function recordTokens(usageSnapshot) {
    if (usageSnapshot === null || typeof usageSnapshot !== 'object' || Array.isArray(usageSnapshot)) return;

    tokPrompt += Number(usageSnapshot.promptTokens) || 0;
    tokCompletion += Number(usageSnapshot.completionTokens) || 0;
    tokCacheHit += Number(usageSnapshot.cacheHitTokens) || 0;
    tokCalls += Number(usageSnapshot.calls) || 0;
    apiErrors += Number(usageSnapshot.apiErrors) || 0;
    if (usageSnapshot.balanceExhausted === true) balanceExhausted = true;
  }

  /**
   * Возвращает plain-объект дневного отчёта.
   *
   * @param {Date} [date] — опциональный явный Date для поля date (YYYY-MM-DD по UTC);
   *   если date не валидный Date → поле date = null (не бросает).
   * @returns {object}
   */
  function snapshot(date) {
    let dateStr = null;
    if (date instanceof Date && !isNaN(date.getTime())) {
      const yyyy = date.getUTCFullYear();
      const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(date.getUTCDate()).padStart(2, '0');
      dateStr = `${yyyy}-${mm}-${dd}`;
    }

    return {
      date: dateStr,
      accountsCount: accountNames.size,
      accounts: [...accountNames].sort(),
      applications: {
        viewed,
        applied,
        skipped,
        manual,
        alreadyApplied,
        dryRun,
        errors,
      },
      messages: {
        processed: msgProcessed,
        replied: msgReplied,
        skippedNoReply: msgSkippedNoReply,
        manual: msgManual,
      },
      resume: {
        editsApplied: resumeEditsApplied,
        editsSkipped: resumeEditsSkipped,
        addedSkillsTotal,
      },
      tokens: {
        promptTokens: tokPrompt,
        completionTokens: tokCompletion,
        cacheHitTokens: tokCacheHit,
        calls: tokCalls,
        apiErrors,
        balanceExhausted,
      },
    };
  }

  /**
   * Возвращает короткую русскую строку-итог дня.
   *
   * @returns {string}
   */
  function formatLine() {
    const totalTokens = tokPrompt + tokCompletion;
    return (
      `День: аккаунтов ${accountNames.size}, откликов ${applied}, ` +
      `сообщений обработано ${msgProcessed}, правок резюме ${resumeEditsApplied + resumeEditsSkipped}, ` +
      `токенов ${totalTokens} (вызовов ${tokCalls}).`
    );
  }

  return { recordAccountRun, recordMessages, recordResumeEdit, recordTokens, snapshot, formatLine };
}
