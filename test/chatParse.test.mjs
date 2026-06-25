import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseThreadList } from '../src/lib/chatParse.js';

// Загружаем синтетическую фикстуру (PII-free, выдуманные данные)
const fixtureHtml = readFileSync(
  new URL('./fixtures/chatik-threadlist.html', import.meta.url),
  'utf8',
);

// --- parseThreadList: базовые свойства ---

test('parseThreadList: возвращает 4 треда из фикстуры', () => {
  const threads = parseThreadList(fixtureHtml);
  assert.equal(threads.length, 4);
});

test('parseThreadList: прочитанные треды имеют unread=false, unreadCount=0', () => {
  const threads = parseThreadList(fixtureHtml);
  // Треды 1 и 2 (chatId 5000000001, 5000000002) — прочитанные
  const read = threads.filter((t) => t.chatId === '5000000001' || t.chatId === '5000000002');
  assert.equal(read.length, 2, 'должно быть 2 прочитанных треда');
  for (const t of read) {
    assert.equal(t.unread, false, `chatId=${t.chatId}: unread должен быть false`);
    assert.equal(t.unreadCount, 0, `chatId=${t.chatId}: unreadCount должен быть 0`);
  }
});

test('parseThreadList: непрочитанный тред 5000000003 → unread=true, unreadCount=1', () => {
  const threads = parseThreadList(fixtureHtml);
  const t = threads.find((t) => t.chatId === '5000000003');
  assert.ok(t, 'тред 5000000003 должен присутствовать');
  assert.equal(t.unread, true);
  assert.equal(t.unreadCount, 1);
});

test('parseThreadList: непрочитанный тред 5000000004 → unread=true, unreadCount=3', () => {
  const threads = parseThreadList(fixtureHtml);
  const t = threads.find((t) => t.chatId === '5000000004');
  assert.ok(t, 'тред 5000000004 должен присутствовать');
  assert.equal(t.unread, true);
  assert.equal(t.unreadCount, 3);
});

test('parseThreadList: chatId извлекается как строка', () => {
  const threads = parseThreadList(fixtureHtml);
  for (const t of threads) {
    assert.equal(typeof t.chatId, 'string', `chatId должен быть строкой, got ${typeof t.chatId}`);
    assert.match(t.chatId, /^\d+$/, `chatId "${t.chatId}" должен состоять из цифр`);
  }
});

test('parseThreadList: href извлекается верно для каждого треда', () => {
  const threads = parseThreadList(fixtureHtml);
  const expected = {
    '5000000001': '/chat/5000000001?hhtmFrom=app',
    '5000000002': '/chat/5000000002?hhtmFrom=app',
    '5000000003': '/chat/5000000003?hhtmFrom=app',
    '5000000004': '/chat/5000000004?hhtmFrom=app',
  };
  for (const t of threads) {
    assert.equal(t.href, expected[t.chatId], `href для chatId=${t.chatId} не совпадает`);
  }
});

// --- parseThreadList: защитные случаи ---

test('parseThreadList: не-строка → []', () => {
  assert.deepEqual(parseThreadList(null), []);
  assert.deepEqual(parseThreadList(undefined), []);
  assert.deepEqual(parseThreadList(42), []);
  assert.deepEqual(parseThreadList({}), []);
});

test('parseThreadList: пустая строка → []', () => {
  assert.deepEqual(parseThreadList(''), []);
});

test('parseThreadList: HTML без тредов → []', () => {
  assert.deepEqual(parseThreadList('<div>нет тредов</div>'), []);
});

// --- parseThreadList: синтетический кейс — бейдж без числа → unread=true, unreadCount=0 ---

test('parseThreadList: бейдж без числа → unread=true, unreadCount=0', () => {
  // data-qa="chatik-info-badges" присутствует, но между тегами нет цифры
  const html = `
    <a data-qa="chatik-open-chat-9999" href="/chat/9999?hhtmFrom=app">
      <span data-qa="chatik-info-badges"></span>
    </a>
  `;
  const threads = parseThreadList(html);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].unread, true, 'бейдж без числа = факт непрочитанного');
  assert.equal(threads[0].unreadCount, 0, 'число = 0 если не распарсилось');
});

test('parseThreadList: число в бейдже с пробелами/переносом → unreadCount извлекается', () => {
  const html = `
    <a data-qa="chatik-open-chat-9001" href="/chat/9001?hhtmFrom=app">
      <span data-qa="chatik-info-badges">
        7
      </span>
    </a>
  `;
  const threads = parseThreadList(html);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].unread, true);
  assert.equal(threads[0].unreadCount, 7, 'число должно извлекаться сквозь пробелы');
});

test('parseThreadList: число во вложенном узле бейджа → unreadCount извлекается', () => {
  const html = `
    <a data-qa="chatik-open-chat-9002" href="/chat/9002?hhtmFrom=app">
      <div data-qa="chatik-info-badges"><span>5</span></div>
    </a>
  `;
  const threads = parseThreadList(html);
  assert.equal(threads[0].unreadCount, 5, 'число из вложенного <span> должно извлекаться');
});

test('parseThreadList: хвостовой бейдж после последней ячейки не приписывается треду', () => {
  // Прочитанная последняя ячейка + посторонний бейдж в футере вне <a>
  const html = `
    <a data-qa="chatik-open-chat-9003" href="/chat/9003?hhtmFrom=app"><div>тред</div></a>
    <div class="footer"><span data-qa="chatik-info-badges">9</span></div>
  `;
  const threads = parseThreadList(html);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].unread, false, 'хвостовой бейдж не должен делать тред непрочитанным');
  assert.equal(threads[0].unreadCount, 0);
});
