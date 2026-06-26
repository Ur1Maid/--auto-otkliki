import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  cacheKey,
  getCached,
  hashResume,
  loadCache,
  saveCache,
  setCached,
} from '../src/lib/scoreCache.js';

// --- hashResume ---

test('hashResume: детерминирован (тот же вход → тот же хэш)', () => {
  const h1 = hashResume('Node.js разработчик с опытом Docker');
  const h2 = hashResume('Node.js разработчик с опытом Docker');
  assert.equal(h1, h2);
});

test('hashResume: разный текст → разный хэш', () => {
  const h1 = hashResume('резюме А');
  const h2 = hashResume('резюме Б');
  assert.notEqual(h1, h2);
});

test('hashResume: длина результата ровно 16 hex-символов', () => {
  const h = hashResume('любой текст');
  assert.equal(h.length, 16);
  assert.match(h, /^[0-9a-f]{16}$/);
});

test('hashResume: не-строка не бросает, возвращает хэш длиной 16', () => {
  assert.doesNotThrow(() => hashResume(null));
  assert.doesNotThrow(() => hashResume(undefined));
  assert.doesNotThrow(() => hashResume(42));
  assert.equal(hashResume(null).length, 16);
});

test('hashResume: не-строка даёт хэш от пустой строки', () => {
  assert.equal(hashResume(null), hashResume(''));
  assert.equal(hashResume(undefined), hashResume(''));
});

// --- cacheKey ---

test('cacheKey: валидный vacancy URL → "<normalized>|<hash>"', () => {
  const hash = hashResume('резюме');
  const key = cacheKey('https://hh.ru/vacancy/12345?from=search#top', hash);
  assert.equal(key, `https://hh.ru/vacancy/12345|${hash}`);
});

test('cacheKey: не-vacancy URL → пустая строка', () => {
  const hash = hashResume('резюме');
  assert.equal(cacheKey('https://hh.ru/search/vacancy?text=x', hash), '');
  assert.equal(cacheKey('https://example.com/page', hash), '');
  assert.equal(cacheKey('', hash), '');
});

test('cacheKey: битый/не-строковый URL не бросает, возвращает ""', () => {
  const hash = hashResume('резюме');
  assert.doesNotThrow(() => cacheKey('http://[bad', hash));
  assert.equal(cacheKey('http://[bad', hash), '');
  assert.equal(cacheKey(null, hash), '');
  assert.equal(cacheKey(42, hash), '');
});

test('cacheKey: один URL с разными query → одинаковый ключ (нормализация срезает query)', () => {
  const hash = hashResume('резюме');
  const key1 = cacheKey('https://hh.ru/vacancy/99001?from=recommend', hash);
  const key2 = cacheKey('https://hh.ru/vacancy/99001?from=search&hhid=abc', hash);
  assert.equal(key1, key2);
});

test('cacheKey: один URL с разными resumeHash → разные ключи', () => {
  const h1 = hashResume('резюме 1');
  const h2 = hashResume('резюме 2');
  const key1 = cacheKey('https://hh.ru/vacancy/55555', h1);
  const key2 = cacheKey('https://hh.ru/vacancy/55555', h2);
  assert.notEqual(key1, key2);
});

// --- getCached / setCached ---

test('setCached → getCached: round-trip', () => {
  const cache = {};
  const key = 'https://hh.ru/vacancy/1|abc1234567890123';
  setCached(cache, key, { score: 80, reason: 'тест' });
  const result = getCached(cache, key);
  assert.deepEqual(result, { score: 80, reason: 'тест' });
});

test('getCached: промах → null', () => {
  assert.equal(getCached({}, 'https://hh.ru/vacancy/1|abc'), null);
});

test('getCached: пустой ключ → null', () => {
  const cache = { '': { score: 50, reason: 'x' } };
  assert.equal(getCached(cache, ''), null);
});

test('getCached: cache не объект → null', () => {
  assert.equal(getCached(null, 'key'), null);
  assert.equal(getCached('string', 'key'), null);
  assert.equal(getCached(undefined, 'key'), null);
});

test('setCached: пустой ключ → no-op, cache не меняется', () => {
  const cache = {};
  setCached(cache, '', { score: 70, reason: 'x' });
  assert.deepEqual(cache, {});
});

test('setCached: score не число → не записывает', () => {
  const cache = {};
  setCached(cache, 'key', { score: 'семьдесят', reason: 'x' });
  assert.deepEqual(cache, {});
  setCached(cache, 'key', { score: NaN, reason: 'x' });
  assert.deepEqual(cache, {});
});

test('setCached: score кламп 150 → 100 при записи', () => {
  const cache = {};
  setCached(cache, 'key', { score: 150, reason: 'выход за пределы' });
  assert.equal(cache['key'].score, 100);
});

test('getCached: кламп score 150 в файле → читается 100', () => {
  // Эмулируем порченный файл: score вне диапазона записан напрямую
  const cache = { 'some|key': { score: 150, reason: 'x' } };
  const result = getCached(cache, 'some|key');
  assert.equal(result.score, 100);
});

test('getCached: кламп score -10 → 0', () => {
  const cache = { 'k': { score: -10, reason: 'neg' } };
  assert.equal(getCached(cache, 'k').score, 0);
});

test('setCached: score кламп -10 → 0 при записи', () => {
  const cache = {};
  setCached(cache, 'key', { score: -10, reason: 'neg' });
  assert.equal(cache['key'].score, 0);
});

test('setCached: null value → no-op', () => {
  const cache = {};
  setCached(cache, 'key', null);
  assert.deepEqual(cache, {});
});

// --- loadCache / saveCache ---

test('saveCache → loadCache: round-trip на временном файле', async () => {
  const filePath = path.join(tmpdir(), `score-cache-test-${Date.now()}.json`);
  const cache = {
    'https://hh.ru/vacancy/42|abcdef1234567890': { score: 75, reason: 'релевантно' },
  };
  await saveCache(filePath, cache);
  const loaded = await loadCache(filePath);
  assert.deepEqual(loaded, cache);
  await unlink(filePath).catch(() => {});
});

test('loadCache: несуществующий файл → {}', async () => {
  const filePath = path.join(tmpdir(), `score-cache-nonexistent-${Date.now()}.json`);
  const result = await loadCache(filePath);
  assert.deepEqual(result, {});
});

test('loadCache: битый JSON → {}', async () => {
  const filePath = path.join(tmpdir(), `score-cache-broken-${Date.now()}.json`);
  await writeFile(filePath, '{not json', 'utf8');
  const result = await loadCache(filePath);
  assert.deepEqual(result, {});
  await unlink(filePath).catch(() => {});
});

test('loadCache: JSON массив → {} (не объект)', async () => {
  const filePath = path.join(tmpdir(), `score-cache-arr-${Date.now()}.json`);
  await writeFile(filePath, '[1,2,3]', 'utf8');
  const result = await loadCache(filePath);
  assert.deepEqual(result, {});
  await unlink(filePath).catch(() => {});
});

test('saveCache: не бросает на плохом пути', async () => {
  // Несуществующий каталог → writeFile упадёт, saveCache заглушит
  const badPath = path.join(tmpdir(), `nonexistent-dir-${Date.now()}`, 'cache.json');
  await assert.doesNotReject(() => saveCache(badPath, { key: { score: 50, reason: '' } }));
});

test('saveCache: сливает с содержимым на диске (чужие ключи не теряются)', async () => {
  // Имитация параллельного аккаунта: на диске уже есть запись B, мы пишем запись A.
  const filePath = path.join(tmpdir(), `score-cache-merge-${Date.now()}.json`);
  await saveCache(filePath, { 'urlB|hashB': { score: 80, reason: 'B' } });
  await saveCache(filePath, { 'urlA|hashA': { score: 60, reason: 'A' } });
  const loaded = await loadCache(filePath);
  assert.deepEqual(loaded['urlB|hashB'], { score: 80, reason: 'B' }, 'запись B не должна потеряться');
  assert.deepEqual(loaded['urlA|hashA'], { score: 60, reason: 'A' }, 'запись A должна добавиться');
  await unlink(filePath).catch(() => {});
});

test('saveCache: при слиянии запись из памяти побеждает диск по тому же ключу', async () => {
  const filePath = path.join(tmpdir(), `score-cache-winmem-${Date.now()}.json`);
  await saveCache(filePath, { 'k|h': { score: 10, reason: 'старое' } });
  await saveCache(filePath, { 'k|h': { score: 90, reason: 'новое' } });
  const loaded = await loadCache(filePath);
  assert.deepEqual(loaded['k|h'], { score: 90, reason: 'новое' });
  await unlink(filePath).catch(() => {});
});

// --- Инвалидация по смене резюме ---

test('инвалидация: два разных resumeHash для одного URL → разные ключи → разные записи', () => {
  const url = 'https://hh.ru/vacancy/77777';
  const h1 = hashResume('резюме DevOps-инженера');
  const h2 = hashResume('резюме фронтенд-разработчика');
  const key1 = cacheKey(url, h1);
  const key2 = cacheKey(url, h2);
  assert.notEqual(key1, key2);

  const cache = {};
  setCached(cache, key1, { score: 85, reason: 'DevOps match' });
  setCached(cache, key2, { score: 30, reason: 'frontend no match' });

  const r1 = getCached(cache, key1);
  const r2 = getCached(cache, key2);
  assert.equal(r1.score, 85);
  assert.equal(r2.score, 30);
  assert.notEqual(r1.reason, r2.reason);
});
