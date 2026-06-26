// Чистые хелперы для сравнения ответов и обнаружения голоса работодателя.

import { normalizeText } from './knowledge.js';

export function matchesAnyPattern(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export function looksLikeEmployerVoice(text) {
  return /ваш опыт релевантен|готов[ыа] пригласить|мы пригласим|рассмотрим вашу кандидатуру|подходите нашей компании|приглашаем вас|будем рады пригласить/i.test(text);
}

export function optionMatches(left, right) {
  return normalizeText(left) === normalizeText(right);
}
