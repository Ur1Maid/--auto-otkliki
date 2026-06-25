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

  const result = await callDeepSeek({ ...ARGS, sleep: async () => {} });
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

// --- retry-with-backoff tests ---

test('callDeepSeek: 429 затем OK → { ok: true, content }, fetch вызван 2 раза', async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    if (callCount === 1) {
      return { ok: false, status: 429, text: async () => 'rate limited' };
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'retry-ok' } }] }),
    };
  };

  const result = await callDeepSeek({ ...ARGS, maxRetries: 2, sleep: async () => {} });
  assert.deepEqual(result, { ok: true, content: 'retry-ok' });
  assert.equal(callCount, 2);
});

test('callDeepSeek: постоянный сетевой сбой → { ok:false, status:0, body:\'\' }, fetch вызван 3 раза', async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    throw new Error('network failure');
  };

  const result = await callDeepSeek({ ...ARGS, maxRetries: 2, sleep: async () => {} });
  assert.deepEqual(result, { ok: false, status: 0, body: '' });
  assert.equal(callCount, 3);
});

test('callDeepSeek: HTTP 402 не повторяет запрос → fetch вызван 1 раз', async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return { ok: false, status: 402, text: async () => 'insufficient balance' };
  };

  const result = await callDeepSeek({ ...ARGS, maxRetries: 2, sleep: async () => {} });
  assert.deepEqual(result, { ok: false, status: 402, body: 'insufficient balance' });
  assert.equal(callCount, 1);
});

test('callDeepSeek: успех с первой попытки → fetch вызван 1 раз', async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'first-try' } }] }),
    };
  };

  const result = await callDeepSeek({ ...ARGS, maxRetries: 2, sleep: async () => {} });
  assert.deepEqual(result, { ok: true, content: 'first-try' });
  assert.equal(callCount, 1);
});

test('callDeepSeek: sleep вызывается с задержками 500ms и 1000ms при двух ретраях', async () => {
  const delays = [];
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    throw new Error('network failure');
  };

  await callDeepSeek({
    ...ARGS,
    maxRetries: 2,
    sleep: async (ms) => { delays.push(ms); },
  });

  assert.deepEqual(delays, [500, 1000]);
});
