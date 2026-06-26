// Чистый модуль алертинга. Принимает снапшот дневного отчёта (dailyReport.snapshot())
// и пороги, возвращает массив алертов. Без IO/сети — доставку (лог/файл/вебхук) делает
// вызывающий код (daemon.js). Never throws.
//
// Уровни: 'critical' (требует вмешательства — баланс/сломанный поток),
//         'warn' (стоит присмотреться — частые ошибки/много ручного).

/** Пороги по умолчанию. Переопределяются через второй аргумент evaluateAlerts. */
export const DEFAULT_THRESHOLDS = {
  maxApiErrors: 3, // вызовов DeepSeek с ошибкой за день
  maxErrors: 5, // ошибок в откликах за день
  maxManual: 15, // тредов, ушедших в ручную, за день
  minViewedForFlowCheck: 5, // с какого числа просмотров проверять «поток сломан»
};

const num = (v) => (Number.isFinite(v) ? v : 0);

/**
 * Оценивает дневной снапшот против порогов и возвращает список алертов.
 * @param {object} snapshot — результат dailyReport.snapshot()
 * @param {Partial<typeof DEFAULT_THRESHOLDS>} [thresholds]
 * @returns {Array<{ level: 'critical'|'warn', code: string, message: string }>}
 */
export function evaluateAlerts(snapshot, thresholds = {}) {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return [];
  const t = { ...DEFAULT_THRESHOLDS, ...(thresholds && typeof thresholds === 'object' ? thresholds : {}) };
  const alerts = [];

  const apps = snapshot.applications && typeof snapshot.applications === 'object' ? snapshot.applications : {};
  const msgs = snapshot.messages && typeof snapshot.messages === 'object' ? snapshot.messages : {};
  const tok = snapshot.tokens && typeof snapshot.tokens === 'object' ? snapshot.tokens : {};

  const viewed = num(apps.viewed);
  const applied = num(apps.applied);
  const errors = num(apps.errors);
  const manual = num(msgs.manual);
  const apiErrors = num(tok.apiErrors);

  // CRITICAL: баланс DeepSeek исчерпан (HTTP 402) — авто-ответы/скоринг деградируют.
  if (tok.balanceExhausted === true) {
    alerts.push({
      level: 'critical',
      code: 'deepseek_balance',
      message: 'DeepSeek: исчерпан баланс (HTTP 402). Ответы и скоринг деградируют — пополни баланс.',
    });
  }

  // CRITICAL: поток откликов вероятно сломан — смотрели вакансии, но 0 откликов при ошибках
  // (типичный признак сломанного селектора hh.ru после смены вёрстки).
  if (viewed >= t.minViewedForFlowCheck && applied === 0 && errors > 0) {
    alerts.push({
      level: 'critical',
      code: 'flow_broken',
      message: `Поток откликов: просмотрено ${viewed}, откликов 0, ошибок ${errors} — вероятно сломан селектор hh.ru.`,
    });
  }

  // WARN: много ошибок API DeepSeek за день.
  if (apiErrors >= t.maxApiErrors) {
    alerts.push({
      level: 'warn',
      code: 'api_errors',
      message: `DeepSeek: ${apiErrors} ошибок вызова за день (порог ${t.maxApiErrors}).`,
    });
  }

  // WARN: много ошибок в откликах за день.
  if (errors >= t.maxErrors) {
    alerts.push({
      level: 'warn',
      code: 'apply_errors',
      message: `Отклики: ${errors} ошибок за день (порог ${t.maxErrors}).`,
    });
  }

  // WARN: много тредов ушло в ручную — авто-ответ почти не работает.
  if (manual >= t.maxManual) {
    alerts.push({
      level: 'warn',
      code: 'messages_manual',
      message: `Сообщения: ${manual} тредов в ручную за день (порог ${t.maxManual}).`,
    });
  }

  return alerts;
}
