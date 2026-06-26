// Чистые текстовые хелперы: парсинг JSON из модели, очистка сгенерированных ответов.

export function cleanGeneratedAnswer(answer) {
  return answer
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^NO_ANSWER$/i, '')
    .replace(/^Ответ:\s*/i, '')
    .replace(/\[Имя\],?\s*/gi, '')
    .replace(/Меня зовут\s*[,.]?\s*/gi, '')
    .trim();
}

/**
 * Срезает ведущее приветствие из сгенерированного текста. Гардрейл «без приветствия»
 * задан в системном промпте, но модель иногда всё равно начинает с «Здравствуйте!».
 * Это пост-страховка для чат-ответов. Снимает только ОДНО ведущее приветствие и
 * следующую за ним пунктуацию/пробелы. Не-строка → ''. Never throws.
 * @param {unknown} text
 * @returns {string}
 */
export function stripLeadingGreeting(text) {
  if (typeof text !== 'string') return '';
  // (?![а-яёa-z]) после приветствия = граница слова: не даёт «привет» съесть начало
  // «Приветствуется»/«Приветливый» и т.п. Снимает только ОДНО ведущее приветствие.
  return text
    .replace(
      /^\s*(?:здравствуйте|здравствуй|приветствую|привет|добр(?:ый|ое|ого)\s+(?:день|утро|вечер|времени(?:\s+суток)?))(?![а-яёa-z])\s*[!,.…—-]*\s*/i,
      '',
    )
    .trimStart();
}

export function parseJsonObject(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
  return JSON.parse(candidate);
}
