import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripTemplate, loadAccountProfile } from '../src/lib/accountProfile.js';

test('stripTemplate: текст с маркером шаблона → пустая строка', () => {
  const markers = ['Заполните резюме для этого аккаунта'];
  assert.equal(stripTemplate('Заполните резюме для этого аккаунта', markers), '');
});

test('stripTemplate: реальный текст без маркера → как есть', () => {
  const markers = ['Заполните резюме для этого аккаунта'];
  assert.equal(stripTemplate('Senior DevOps, 5 лет опыта', markers), 'Senior DevOps, 5 лет опыта');
});

test('stripTemplate: не-строка → пустая строка', () => {
  assert.equal(stripTemplate(null, ['x']), '');
  assert.equal(stripTemplate(undefined, ['x']), '');
});

test('loadAccountProfile: несуществующий аккаунт → пустые профиль и зарплата (не бросает)', async () => {
  const res = await loadAccountProfile('___nonexistent_test_account___');
  assert.deepEqual(res, { resumeProfile: '', salary: '' });
});
