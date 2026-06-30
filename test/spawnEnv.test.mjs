import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeSpawnEnv } from '../src/lib/spawnEnv.js';

// Все тесты детерминированы: без реального process/spawn, IO или сети.

test('nodeSpawnEnv: ставит ELECTRON_RUN_AS_NODE=1', () => {
  const out = nodeSpawnEnv({ FOO: 'bar' });
  assert.equal(out.ELECTRON_RUN_AS_NODE, '1');
});

test('nodeSpawnEnv: НЕ мутирует входной объект', () => {
  const base = { FOO: 'bar' };
  const out = nodeSpawnEnv(base);
  assert.equal('ELECTRON_RUN_AS_NODE' in base, false);
  assert.notEqual(out, base); // новый объект
});

test('nodeSpawnEnv: сохраняет прочие ключи входа', () => {
  const out = nodeSpawnEnv({ FOO: 'bar', PATH: '/x', DEEPSEEK_API_KEY: 'sk-secret' });
  assert.equal(out.FOO, 'bar');
  assert.equal(out.PATH, '/x');
  assert.equal(out.DEEPSEEK_API_KEY, 'sk-secret');
});

test('nodeSpawnEnv: уже выставленный флаг перезаписывается в "1"', () => {
  const out = nodeSpawnEnv({ ELECTRON_RUN_AS_NODE: '0' });
  assert.equal(out.ELECTRON_RUN_AS_NODE, '1');
});

test('nodeSpawnEnv: не-объект (null/строка/число) → только флаг', () => {
  for (const bad of [null, 'env', 42, false]) {
    const out = nodeSpawnEnv(bad);
    assert.deepEqual(out, { ELECTRON_RUN_AS_NODE: '1' });
  }
});

test('nodeSpawnEnv: без аргумента берёт process.env (флаг выставлен, env скопирован)', () => {
  const out = nodeSpawnEnv();
  assert.equal(out.ELECTRON_RUN_AS_NODE, '1');
  assert.notEqual(out, process.env); // копия, не сам process.env
});
