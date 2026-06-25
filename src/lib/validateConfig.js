// Проверяет наличие обязательных элементов конфигурации (ключ, резюме, зарплата).
// Чистая функция без IO/сети: вызывающий передаёт уже прочитанные и очищенные строки.

/**
 * Проверяет конфигурацию аккаунта и возвращает списки ошибок и предупреждений.
 *
 * @param {{ apiKey?: unknown, resume?: unknown, salary?: unknown }} [opts]
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateConfig({ apiKey, resume, salary } = {}) {
  const errors = [];
  const warnings = [];

  // Не-строки трактуются как пустые
  const keyStr = typeof apiKey === 'string' ? apiKey.trim() : '';
  const resumeStr = typeof resume === 'string' ? resume.trim() : '';
  const salaryStr = typeof salary === 'string' ? salary.trim() : '';

  if (!keyStr) {
    errors.push('Не задан DEEPSEEK_API_KEY: вставьте ключ в .env (см. .env.example).');
  }

  if (!resumeStr) {
    errors.push('Резюме не заполнено: заполните config/accounts/<account>/resume.md (сейчас пусто или шаблон).');
  }

  if (!salaryStr) {
    warnings.push('Зарплатные ожидания не заполнены: на вопросы о зарплате ответа не будет (salary.md пуст).');
  }

  return { ok: errors.length === 0, errors, warnings };
}
