import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callDeepSeek } from '../src/lib/deepseek.js';

// --- callDeepSeek ---

const ARGS = {
  apiKey: 'test-key-123',
  apiUrl: 'https://api.deepseek.com/chat/completions',
  model: 'deepseek-chat',
  messages: [{ role: 'user', content: 'ping' }],
  temperature: 0,
  maxTokens: 50,
};

let originalFetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

test('callDeepSeek: OK путь возвращает content из ответа', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'hi' } }] }),
  });

  const result = await callDeepSeek(ARGS);
  assert.deepEqual(result, { ok: true, content: 'hi' });
});

test('callDeepSeek: пустые choices → content по умолчанию пустая строка', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [] }),
  });

  const result = await callDeepSeek(ARGS);
  assert.deepEqual(result, { ok: true, content: '' });
});

test('callDeepSeek: malformed json response → content пустая строка', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => null,
  });

  const result = await callDeepSeek(ARGS);
  assert.deepEqual(result, { ok: true, content: '' });
});

test('callDeepSeek: HTTP 402 → { ok: false, status: 402, body }', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 402,
    text: async () => 'insufficient balance',
  });

  const result = await callDeepSeek(ARGS);
  assert.deepEqual(result, { ok: false, status: 402, body: 'insufficient balance' });
});

test('callDeepSeek: сетевой сбой (fetch reject) → { ok: false, status: 0, body: \'\' }', async () => {
  globalThis.fetch = async () => { throw new Error('network failure'); };

  const result = await callDeepSeek(ARGS);
  assert.deepEqual(result, { ok: false, status: 0, body: '' });
});

test('callDeepSeek: Authorization header содержит Bearer ключ', async () => {
  let capturedInit;
  globalThis.fetch = async (_url, init) => {
    capturedInit = init;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    };
  };

  await callDeepSeek(ARGS);
  assert.equal(capturedInit.headers['Authorization'], `Bearer ${ARGS.apiKey}`);
});

test('callDeepSeek: возвращаемый объект не содержит apiKey', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'secret-free' } }] }),
  });

  const result = await callDeepSeek(ARGS);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(ARGS.apiKey), `apiKey обнаружен в возвращённом объекте: ${serialized}`);
});
