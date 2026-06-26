import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResumeProfile } from '../src/lib/resumeProfile.js';

// --- buildResumeProfile ---

test('buildResumeProfile: содержит навыки Kubernetes, Docker, GitLab CI/CD из резюме', () => {
  const resume = `# DevOps Engineer
Опыт: Kubernetes, Docker, GitLab CI/CD, деплой сервисов.`;
  const result = buildResumeProfile(resume);
  assert.ok(result.includes('Kubernetes'), 'должен присутствовать Kubernetes');
  assert.ok(result.includes('Docker'), 'должен присутствовать Docker');
  assert.ok(result.includes('GitLab CI/CD'), 'должен присутствовать GitLab CI/CD');
});

test('buildResumeProfile: роль берётся из первой непустой строки без markdown-символов', () => {
  const resume = `# Senior DevOps Engineer
Kubernetes, Docker.`;
  const result = buildResumeProfile(resume);
  assert.ok(result.includes('Роль: Senior DevOps Engineer'), 'роль должна быть без символа #');
});

test('buildResumeProfile: пустое резюме → «»', () => {
  assert.equal(buildResumeProfile(''), '');
});

test('buildResumeProfile: резюме из пробелов → «»', () => {
  assert.equal(buildResumeProfile('   \n  \t  '), '');
});

test('buildResumeProfile: результат никогда не превышает maxLen символов', () => {
  const resume = `DevOps\n${Array(200).fill('Kubernetes Docker Bash Python Terraform Ansible').join(' ')}`;
  const result = buildResumeProfile(resume, 600);
  assert.ok(result.length <= 600, `длина ${result.length} превышает maxLen=600`);
});

test('buildResumeProfile: ключевое слово-подстрока длинного слова НЕ включается в навыки', () => {
  // 'monitoring' — реальное ключевое слово; «supermonitoring» не должно совпадать
  const resume = 'DevOps\nsupermonitoring system deployed';
  const result = buildResumeProfile(resume);
  // 'monitoring' не должно появиться в навыках, т.к. в тексте только «supermonitoring»
  const skillsLine = result.split('\n').find((l) => l.startsWith('Навыки:')) || '';
  const skills = skillsLine.replace('Навыки: ', '').split(', ');
  assert.ok(!skills.includes('monitoring'), 'monitoring не должен совпадать как подстрока');
});

test('buildResumeProfile: навыки сохраняют порядок из RESUME_KEYWORDS', () => {
  // Kubernetes(2) стоит в списке раньше Bash(15)
  const resume = 'Engineer\nНавыки: Bash, Kubernetes';
  const result = buildResumeProfile(resume);
  const skillsLine = result.split('\n').find((l) => l.startsWith('Навыки:')) || '';
  const idxK = skillsLine.indexOf('Kubernetes');
  const idxB = skillsLine.indexOf('Bash');
  assert.ok(idxK !== -1 && idxB !== -1, 'оба навыка должны присутствовать');
  assert.ok(idxK < idxB, 'Kubernetes должен идти раньше Bash согласно порядку RESUME_KEYWORDS');
});
