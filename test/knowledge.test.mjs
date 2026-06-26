import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESUME_KEYWORDS,
  normalizeText,
  extractResumeKeywords,
  getSearchTerms,
  pickKnowledgeChunks
} from '../src/lib/knowledge.js';

// --- normalizeText ---

test('normalizeText: схлопывает пробелы, обрезает, переводит в нижний регистр', () => {
  assert.equal(normalizeText('  Много   Пробелов  '), 'много пробелов');
});

test('normalizeText: не трогает уже нормализованный текст', () => {
  assert.equal(normalizeText('hello world'), 'hello world');
});

test('normalizeText: переводит верхний регистр в нижний', () => {
  assert.equal(normalizeText('UPPER CASE'), 'upper case');
});

// --- extractResumeKeywords ---

test('extractResumeKeywords: находит ключевые слова как отдельные токены', () => {
  const result = extractResumeKeywords('опыт с Kubernetes и Docker');
  assert.ok(result.includes('Kubernetes'), 'должен найти Kubernetes');
  assert.ok(result.includes('Docker'), 'должен найти Docker');
});

test('extractResumeKeywords: НЕ совпадает, если ключевое слово — подстрока длинного слова', () => {
  // 'monitoring' — реальное ключевое слово; «supermonitoring» не должно совпадать
  const result = extractResumeKeywords('supermonitoring system');
  assert.ok(!result.includes('monitoring'), 'не должен совпадать как подстрока');
});

test('extractResumeKeywords: возвращает [] когда нет совпадений', () => {
  const result = extractResumeKeywords('обычный текст без ключевых слов');
  assert.deepEqual(result, []);
});

test('extractResumeKeywords: совпадение нечувствительно к регистру', () => {
  const result = extractResumeKeywords('используем linux в продакшне');
  assert.ok(result.includes('Linux'), 'должен найти Linux без учёта регистра');
});

// --- getSearchTerms ---

test('getSearchTerms: отбрасывает стоп-слова', () => {
  const result = getSearchTerms('что для the and системы');
  assert.ok(!result.includes('что'), 'стоп-слово "что" должно быть отброшено');
  assert.ok(!result.includes('для'), 'стоп-слово "для" должно быть отброшено');
  assert.ok(!result.includes('the'), 'стоп-слово "the" должно быть отброшено');
  assert.ok(!result.includes('and'), 'стоп-слово "and" должно быть отброшено');
  assert.ok(result.includes('системы'), 'обычное слово должно остаться');
});

test('getSearchTerms: отбрасывает токены короче 3 символов', () => {
  const result = getSearchTerms('он на ok hello');
  assert.ok(!result.includes('он'), 'короткое слово "он" должно быть отброшено');
  assert.ok(!result.includes('на'), 'короткое слово "на" должно быть отброшено');
  assert.ok(!result.includes('ok'), 'короткое слово "ok" должно быть отброшено');
  assert.ok(result.includes('hello'), '"hello" (5 символов) должен остаться');
});

test('getSearchTerms: дедуплицирует токены', () => {
  const result = getSearchTerms('linux linux linux');
  assert.equal(result.filter((t) => t === 'linux').length, 1, 'дублирующиеся токены должны схлопываться');
});

// --- pickKnowledgeChunks ---

test('pickKnowledgeChunks: возвращает [] когда нет пересечений по терминам', () => {
  const kb = [{ text: 'совсем другая тема' }];
  const result = pickKnowledgeChunks('kubernetes docker', kb);
  assert.deepEqual(result, []);
});

test('pickKnowledgeChunks: сортирует чанки по числу совпавших терминов по убыванию', () => {
  const kb = [
    { text: 'docker контейнеры' },
    { text: 'kubernetes docker helm деплой' }
  ];
  const result = pickKnowledgeChunks('kubernetes docker helm', kb);
  assert.ok(result.length >= 2, 'должны вернуться оба чанка');
  assert.ok(result[0].text.includes('kubernetes'), 'чанк с тремя совпадениями должен быть первым');
});

test('pickKnowledgeChunks: соблюдает аргумент limit', () => {
  const kb = [
    { text: 'linux системы администрирование' },
    { text: 'linux сервер конфигурация' },
    { text: 'linux bash скрипты' }
  ];
  const result = pickKnowledgeChunks('linux bash', kb, 2);
  assert.equal(result.length, 2, 'должно вернуться не более 2 чанков');
});

test('pickKnowledgeChunks: возвращает [] при пустом контексте без терминов', () => {
  const kb = [{ text: 'что-то полезное' }];
  // строка только из стоп-слов и коротких токенов → getSearchTerms вернёт []
  const result = pickKnowledgeChunks('the for', kb);
  assert.deepEqual(result, []);
});

test('pickKnowledgeChunks: дефолтный limit равен 2 — возвращает не более 2 чанков', () => {
  const kb = [
    { text: 'linux kubernetes docker helm' },
    { text: 'linux bash скрипты' },
    { text: 'linux ansible terraform' }
  ];
  // Все три чанка совпадают по «linux», но дефолт limit=2 должен вернуть не более 2.
  const result = pickKnowledgeChunks('linux', kb);
  assert.ok(result.length <= 2, `дефолт limit=2 должен вернуть ≤2 чанка, получено: ${result.length}`);
});

test('pickKnowledgeChunks: maxChunkChars усекает текст до 600 символов по умолчанию', () => {
  const longText = 'kubernetes '.repeat(100); // 1100 символов
  const kb = [{ text: longText }];
  const result = pickKnowledgeChunks('kubernetes', kb);
  assert.ok(result.length === 1, 'должен вернуть один чанк');
  assert.ok(result[0].text.length <= 600, `текст должен быть усечён до 600 симв., длина: ${result[0].text.length}`);
});

test('pickKnowledgeChunks: явный maxChunkChars=100 усекает текст до 100 символов', () => {
  const longText = 'docker '.repeat(50); // 350 символов
  const kb = [{ text: longText }];
  const result = pickKnowledgeChunks('docker', kb, 1, 100);
  assert.ok(result.length === 1, 'должен вернуть один чанк');
  assert.ok(result[0].text.length <= 100, `текст должен быть усечён до 100 симв., длина: ${result[0].text.length}`);
});

test('pickKnowledgeChunks: явный limit=3 возвращает до 3 чанков', () => {
  const kb = [
    { text: 'linux kubernetes docker helm' },
    { text: 'linux bash скрипты' },
    { text: 'linux ansible terraform' }
  ];
  const result = pickKnowledgeChunks('linux', kb, 3);
  assert.equal(result.length, 3, 'явный limit=3 должен вернуть все 3 чанка');
});

test('pickKnowledgeChunks: maxChunkChars=0 не усекает текст', () => {
  const longText = 'helm '.repeat(50); // 250 символов
  const kb = [{ text: longText }];
  const result = pickKnowledgeChunks('helm', kb, 1, 0);
  assert.ok(result.length === 1, 'должен вернуть один чанк');
  assert.equal(result[0].text, longText, 'при maxChunkChars=0 текст не должен усекаться');
});

test('pickKnowledgeChunks: нечисловой maxChunkChars не усекает текст', () => {
  const longText = 'helm '.repeat(200); // 1000 символов
  const kb = [{ text: longText }];
  const result = pickKnowledgeChunks('helm', kb, 1, null);
  assert.equal(result[0].text, longText, 'при нечисловом maxChunkChars усечение не применяется');
});

// --- RESUME_KEYWORDS ---

test('RESUME_KEYWORDS: содержит ровно 58 записей', () => {
  assert.equal(RESUME_KEYWORDS.length, 58);
});
