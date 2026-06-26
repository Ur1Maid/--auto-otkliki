// Загрузка профиля аккаунта (резюме + зарплата) для генерации ответов/контекста.
// Используется демоном (runMessagesPass), чтобы generateReply имел данные кандидата.
// Скоупится строго по имени аккаунта — данные одного аккаунта не текут в другой.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { getAccountResumePath, getAccountSalaryPath, getAccountPreferencesPath } from '../config.js';

// Маркеры незаполненных шаблонов (дублируются в review.js/check.js намеренно,
// чтобы не тянуть review.js как зависимость).
const RESUME_TEMPLATE_MARKERS = [
  'Заполните здесь краткую информацию из резюме',
  'Заполните резюме для этого аккаунта',
];
const SALARY_TEMPLATE_MARKERS = [
  'Замените этот текст на реальные зарплатные ожидания',
];
const PREFERENCES_TEMPLATE_MARKERS = [
  'Заполните предпочтения кандидата',
];

/** Читает файл или возвращает '' если его нет (best-effort, не бросает). */
async function readOptional(filePath) {
  if (!existsSync(filePath)) return '';
  return readFile(filePath, 'utf8').then((s) => s.trim()).catch(() => '');
}

/** Возвращает '' если текст содержит маркер незаполненного шаблона. */
export function stripTemplate(text, markers) {
  const safe = typeof text === 'string' ? text : '';
  return markers.some((m) => safe.includes(m)) ? '' : safe;
}

/**
 * Загружает резюме, зарплатные ожидания и структурированные предпочтения аккаунта
 * (с отсевом шаблонов). Пустые/шаблонные файлы → ''. Never throws.
 *
 * preferences.txt — необязательный файл со структурированными предпочтениями кандидата
 * (готовность к переезду, тип занятости, командировки, график и т.п.). Нужен, чтобы
 * честно отвечать на типовые вопросы работодателя вместо NO_ANSWER. Скоупится по аккаунту.
 *
 * @param {string} account — имя аккаунта
 * @returns {Promise<{ resumeProfile: string, salary: string, preferences: string }>}
 */
export async function loadAccountProfile(account) {
  const resumeRaw = await readOptional(getAccountResumePath(account));
  const salaryRaw = await readOptional(getAccountSalaryPath(account));
  const preferencesRaw = await readOptional(getAccountPreferencesPath(account));
  return {
    resumeProfile: stripTemplate(resumeRaw, RESUME_TEMPLATE_MARKERS),
    salary: stripTemplate(salaryRaw, SALARY_TEMPLATE_MARKERS),
    preferences: stripTemplate(preferencesRaw, PREFERENCES_TEMPLATE_MARKERS),
  };
}
