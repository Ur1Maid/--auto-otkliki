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

export function parseJsonObject(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
  return JSON.parse(candidate);
}
