import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localRelevanceScore, needsModelScoring } from '../src/lib/localScore.js';

// --- localRelevanceScore ---

test('localRelevanceScore: вакансия требует Kubernetes/Docker/CI-CD, резюме имеет все три → score 100, confident true', () => {
  const vacancy = 'Требуется опыт Kubernetes, Docker и CI/CD';
  const resume = 'Работал с Kubernetes, Docker, CI/CD в продакшне';
  const result = localRelevanceScore(vacancy, resume);
  assert.equal(result.score, 100, 'score должен быть 100');
  assert.equal(result.confident, true, 'confident должен быть true (demanded >= 3)');
  assert.equal(result.demanded, result.overlap, 'demanded должно равняться overlap');
  assert.ok(needsModelScoring(result), 'needsModelScoring должен вернуть true: высокий локальный балл всё равно подтверждает модель перед откликом');
});

test('localRelevanceScore: вакансия требует нескольких навыков, которых нет в резюме → низкий score, confident true, needsModelScoring false', () => {
  const vacancy = 'Нужен опыт Kubernetes, Docker, Terraform, Ansible и Helm';
  const resume = 'Опыт только с Linux и Bash';
  const result = localRelevanceScore(vacancy, resume);
  assert.ok(result.score <= 40, `score ${result.score} должен быть ≤ 40`);
  assert.equal(result.confident, true, 'confident должен быть true (demanded >= 3)');
  assert.ok(!needsModelScoring(result), 'needsModelScoring должен вернуть false (явно низкий скор)');
});

test('localRelevanceScore: вакансия с менее чем 3 распознанными ключевыми словами → confident false → needsModelScoring true', () => {
  // Только 2 ключевых слова из RESUME_KEYWORDS в тексте вакансии
  const vacancy = 'Ищем специалиста с опытом Docker и Python';
  const resume = 'Имею опыт Docker и Python';
  const result = localRelevanceScore(vacancy, resume);
  assert.ok(result.demanded < 3, `demanded ${result.demanded} должен быть < 3`);
  assert.equal(result.confident, false, 'confident должен быть false');
  assert.ok(needsModelScoring(result), 'needsModelScoring должен вернуть true (нет уверенности)');
});

test('localRelevanceScore: середина диапазона, confident true → needsModelScoring true', () => {
  // Вакансия требует 4 навыка, резюме имеет 2 → score 50 — строго между low=40 и high=70
  const vacancy = 'Нужен Kubernetes, Docker, Terraform и Ansible';
  const resume = 'Есть опыт Kubernetes и Docker, а также Linux';
  const result = localRelevanceScore(vacancy, resume);
  // score = round(100 * 2/4) = 50, строго между 40 и 70
  assert.ok(result.demanded >= 3, 'demanded должен быть >= 3 для уверенности');
  assert.equal(result.confident, true, 'confident должен быть true');
  assert.ok(result.score > 40 && result.score < 70, `score ${result.score} должен быть в серой зоне (40..70)`);
  assert.ok(needsModelScoring(result), 'needsModelScoring должен вернуть true (серая зона)');
});

test('localRelevanceScore: пустое резюме → overlap 0', () => {
  const vacancy = 'Нужен опыт Kubernetes, Docker и CI/CD';
  const result = localRelevanceScore(vacancy, '');
  assert.equal(result.overlap, 0, 'overlap должен быть 0 при пустом резюме');
  assert.ok(result.score <= 40, `score ${result.score} должен быть низким`);
});

// --- needsModelScoring ---

test('needsModelScoring: не уверен → всегда true', () => {
  assert.ok(needsModelScoring({ score: 10, confident: false }));
  assert.ok(needsModelScoring({ score: 90, confident: false }));
  assert.ok(needsModelScoring({ score: 50, confident: false }));
});

test('needsModelScoring: уверен и score ≤ low → false (явно нерелевантно)', () => {
  assert.ok(!needsModelScoring({ score: 40, confident: true }));
  assert.ok(!needsModelScoring({ score: 0, confident: true }));
  assert.ok(!needsModelScoring({ score: 20, confident: true }));
});

test('needsModelScoring: уверен и высокий score → true (модель подтверждает любой потенциальный отклик)', () => {
  assert.ok(needsModelScoring({ score: 70, confident: true }));
  assert.ok(needsModelScoring({ score: 100, confident: true }));
  assert.ok(needsModelScoring({ score: 85, confident: true }));
});

test('needsModelScoring: уверен и score строго между low и high → true (серая зона)', () => {
  assert.ok(needsModelScoring({ score: 41, confident: true }));
  assert.ok(needsModelScoring({ score: 55, confident: true }));
  assert.ok(needsModelScoring({ score: 69, confident: true }));
});

test('needsModelScoring: кастомный порог low работает корректно', () => {
  // low=30: только уверенно-низкий (≤30) пропускает модель (локальный reject)
  assert.ok(!needsModelScoring({ score: 30, confident: true }, { low: 30 }));
  assert.ok(needsModelScoring({ score: 50, confident: true }, { low: 30 }));
  assert.ok(needsModelScoring({ score: 80, confident: true }, { low: 30 }));
});
