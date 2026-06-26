import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { ensureAppDirs, storageStatePath, getAccountResumePath, getAccountSalaryPath, rootDir } from './config.js';
import { validateConfig } from './lib/validateConfig.js';

// Грузим .env (как делает review.js), иначе DEEPSEEK_API_KEY ложно покажется «не задан».
try {
  process.loadEnvFile(path.join(rootDir, '.env'));
} catch {
  // .env может отсутствовать — переменные могут быть заданы в окружении.
}

await ensureAppDirs();

console.log(`Node.js: ${process.version}`);
console.log(`Playwright chromium доступен: ${Boolean(chromium)}`);
console.log(`Сессия hh.ru: ${existsSync(storageStatePath) ? 'найдена' : 'не найдена'}`);

// --- проверка конфигурации дефолтного аккаунта ---

// Маркеры незаполненных шаблонов (из review.js, дублируются здесь, чтобы не импортировать review.js)
const RESUME_TEMPLATE_MARKERS = [
  'Заполните здесь краткую информацию из резюме',
  'Заполните резюме для этого аккаунта',
];
const SALARY_TEMPLATE_MARKERS = [
  'Замените этот текст на реальные зарплатные ожидания',
];

/**
 * Читает файл и возвращает строку, или '' если файл отсутствует.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function readOptional(filePath) {
  if (!existsSync(filePath)) return '';
  return (await readFile(filePath, 'utf8')).trim();
}

/**
 * Возвращает '' если текст содержит хотя бы один маркер шаблона.
 * @param {string} text
 * @param {string[]} markers
 * @returns {string}
 */
function stripTemplate(text, markers) {
  return markers.some((m) => text.includes(m)) ? '' : text;
}

const resumePath = getAccountResumePath('default');
const salaryPath = getAccountSalaryPath('default');

const resumeRaw = await readOptional(resumePath);
const salaryRaw = await readOptional(salaryPath);

const resume = stripTemplate(resumeRaw, RESUME_TEMPLATE_MARKERS);
const salary = stripTemplate(salaryRaw, SALARY_TEMPLATE_MARKERS);

// DEEPSEEK_API_KEY читаем как есть из process.env (не логируем сам ключ)
const apiKey = process.env.DEEPSEEK_API_KEY ?? '';

const { ok, errors, warnings } = validateConfig({ apiKey, resume, salary });

console.log(`DEEPSEEK_API_KEY: ${apiKey ? 'задан' : 'не задан'}`);
console.log(`Резюме (default): ${resume ? 'заполнено' : 'пусто или шаблон'}`);
console.log(`Зарплата (default): ${salary ? 'заполнена' : 'пусто или шаблон'}`);

for (const err of errors) {
  console.error(`ОШИБКА: ${err}`);
}
for (const warn of warnings) {
  console.log(`Предупреждение: ${warn}`);
}

if (!ok) {
  process.exit(1);
}
