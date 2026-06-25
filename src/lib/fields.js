// Чистые хелперы для определения типа поля формы и извлечения главного вопроса.

export function isGenericFieldContext(context) {
  return /^(text|textarea|input|без контекста)$/i.test(context.trim());
}

export function detectFieldKind(context, pageText = '') {
  if (/зарплат|заработн|оклад|доход|компенсац|ставк|salary|compensation/i.test(context)) {
    return 'salary';
  }

  if (/сопроводительное письмо|письмо работодателю|cover letter/i.test(`${context}\n${pageText}`)) {
    return 'coverLetter';
  }

  if (isGenericFieldContext(context)) {
    return 'unknown';
  }

  return 'answer';
}

export function isSalaryContext(context) {
  return detectFieldKind(context) === 'salary';
}

export function getMainQuestion(context) {
  const lines = context
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^task_\d+_text$/i.test(line));

  return lines[0] || 'без контекста';
}
