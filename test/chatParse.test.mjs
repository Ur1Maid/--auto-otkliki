import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseThreadList, parseThreadMessages, lastEmployerMessage, mergeThreadsById } from '../src/lib/chatParse.js';

// Загружаем синтетическую фикстуру списка тредов (PII-free, выдуманные данные)
const fixtureHtml = readFileSync(
  new URL('./fixtures/chatik-threadlist.html', import.meta.url),
  'utf8',
);

// Загружаем синтетическую фикстуру открытого треда (PII-free, выдуманные данные)
const threadHtml = readFileSync(
  new URL('./fixtures/chatik-thread.html', import.meta.url),
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

// ===========================================================================
// parseThreadMessages
// ===========================================================================

test('parseThreadMessages: возвращает 3 сообщения из фикстуры', () => {
  const msgs = parseThreadMessages(threadHtml);
  assert.equal(msgs.length, 3);
});

test('parseThreadMessages: порядок хронологический (msgId 1001, 1002, 1003)', () => {
  const msgs = parseThreadMessages(threadHtml);
  assert.deepEqual(
    msgs.map((m) => m.msgId),
    ['1001', '1002', '1003'],
  );
});

test('parseThreadMessages: первое сообщение — applicant (наше)', () => {
  const msgs = parseThreadMessages(threadHtml);
  assert.equal(msgs[0].author, 'applicant');
});

test('parseThreadMessages: второе и третье сообщения — employer (входящие)', () => {
  const msgs = parseThreadMessages(threadHtml);
  assert.equal(msgs[1].author, 'employer');
  assert.equal(msgs[2].author, 'employer');
});

test('parseThreadMessages: msgId — строка из цифр', () => {
  const msgs = parseThreadMessages(threadHtml);
  for (const m of msgs) {
    assert.equal(typeof m.msgId, 'string', `msgId должен быть строкой, got ${typeof m.msgId}`);
    assert.match(m.msgId, /^\d+$/, `msgId "${m.msgId}" должен состоять из цифр`);
  }
});

test('parseThreadMessages: data-qa с суффиксами -text и -applicant-action не считаются контейнерами', () => {
  // Фикстура содержит chatik-chat-message-1001-text и chatik-chat-message-applicant-action —
  // они не должны добавлять лишние сообщения.
  const msgs = parseThreadMessages(threadHtml);
  // Ожидаем ровно 3 сообщения (1001, 1002, 1003), а не больше.
  assert.equal(msgs.length, 3, 'суффиксы -text/-applicant-action не должны создавать лишние записи');
});

test('parseThreadMessages: текст applicant очищен от тегов', () => {
  const msgs = parseThreadMessages(threadHtml);
  const applicant = msgs.find((m) => m.author === 'applicant');
  assert.ok(applicant, 'должно быть сообщение applicant');
  assert.equal(applicant.text, 'Здравствуйте, заинтересован в вакансии');
  // Никаких HTML-тегов в тексте
  assert.ok(!applicant.text.includes('<'), 'текст не должен содержать <');
  assert.ok(!applicant.text.includes('>'), 'текст не должен содержать >');
});

test('parseThreadMessages: HTML-сущности (&quot; &amp;) декодируются', () => {
  const msgs = parseThreadMessages(threadHtml);
  // msgId=1002: содержит &quot; → "
  const msg1002 = msgs.find((m) => m.msgId === '1002');
  assert.ok(msg1002, 'сообщение 1002 должно присутствовать');
  assert.ok(msg1002.text.includes('"'), 'кавычки &quot; должны декодироваться в "');
  // msgId=1003: содержит &amp; → &
  const msg1003 = msgs.find((m) => m.msgId === '1003');
  assert.ok(msg1003, 'сообщение 1003 должно присутствовать');
  assert.ok(msg1003.text.includes('&'), 'амперсанд &amp; должен декодироваться в &');
});

test('parseThreadMessages: несколько <p> и <strong> — теги сняты, текст склеен', () => {
  const msgs = parseThreadMessages(threadHtml);
  // msgId=1002 содержит два <p> и <strong>удобно</strong>
  const msg1002 = msgs.find((m) => m.msgId === '1002');
  assert.ok(msg1002, 'сообщение 1002 должно присутствовать');
  // <strong> снят — слово «удобно» всё равно в тексте
  assert.ok(msg1002.text.includes('удобно'), 'текст из <strong> должен сохраниться');
  // оба <p> объединены — первый и второй абзацы присутствуют
  assert.ok(msg1002.text.includes('Спасибо за отклик'), 'первый <p> должен быть в тексте');
  assert.ok(msg1002.text.includes('созвониться'), 'второй <p> должен быть в тексте');
  // никаких тегов
  assert.ok(!msg1002.text.includes('<'), 'в тексте не должно быть HTML-тегов');
});

// --- parseThreadMessages: защитные случаи ---

test('parseThreadMessages: null → []', () => {
  assert.deepEqual(parseThreadMessages(null), []);
});

test('parseThreadMessages: пустая строка → []', () => {
  assert.deepEqual(parseThreadMessages(''), []);
});

test('parseThreadMessages: число → []', () => {
  assert.deepEqual(parseThreadMessages(42), []);
});

test('parseThreadMessages: HTML без сообщений → []', () => {
  assert.deepEqual(parseThreadMessages('<div>нет сообщений</div>'), []);
});

// ===========================================================================
// lastEmployerMessage
// ===========================================================================

test('lastEmployerMessage: возвращает текст ПОСЛЕДНЕГО входящего (1003, не 1002)', () => {
  const msgs = parseThreadMessages(threadHtml);
  const result = lastEmployerMessage(msgs);
  // Должно быть сообщение 1003 («Подскажите ваш телефон...»), а не 1002
  assert.ok(result.includes('телефон'), 'должен вернуться текст последнего входящего (1003)');
  assert.ok(!result.includes('Спасибо за отклик'), 'не должен вернуться текст первого входящего (1002)');
});

test('lastEmployerMessage: пустой массив → ""', () => {
  assert.equal(lastEmployerMessage([]), '');
});

test('lastEmployerMessage: массив только из applicant → ""', () => {
  const msgs = [
    { msgId: '1', author: 'applicant', text: 'Привет' },
    { msgId: '2', author: 'applicant', text: 'Всё готово' },
  ];
  assert.equal(lastEmployerMessage(msgs), '');
});

test('lastEmployerMessage: не-массив → ""', () => {
  assert.equal(lastEmployerMessage(null), '');
  assert.equal(lastEmployerMessage(undefined), '');
  assert.equal(lastEmployerMessage('строка'), '');
  assert.equal(lastEmployerMessage(42), '');
  assert.equal(lastEmployerMessage({}), '');
});

test('lastEmployerMessage: битые/null элементы пропускаются (не бросает)', () => {
  const msgs = [
    null,
    'строка',
    { msgId: '1', author: 'employer', text: 'Здравствуйте' },
    undefined,
    { msgId: '2', author: 'employer', text: 'Когда удобно созвониться?' },
  ];
  assert.equal(lastEmployerMessage(msgs), 'Когда удобно созвониться?');
});

// ===========================================================================
// mergeThreadsById
// ===========================================================================

test('mergeThreadsById: дедуплицирует по chatId между двумя снимками', () => {
  const acc = [
    { chatId: '1', href: '/chat/1', unread: false, unreadCount: 0 },
    { chatId: '2', href: '/chat/2', unread: false, unreadCount: 0 },
  ];
  const next = [
    { chatId: '2', href: '/chat/2', unread: false, unreadCount: 0 },
    { chatId: '3', href: '/chat/3', unread: true, unreadCount: 1 },
  ];
  const merged = mergeThreadsById(acc, next);
  assert.equal(merged.length, 3, 'должно быть 3 уникальных треда');
  assert.deepEqual(merged.map((t) => t.chatId), ['1', '2', '3']);
});

test('mergeThreadsById: сохраняет порядок первого появления', () => {
  const acc = [{ chatId: '10', href: '/chat/10', unread: false, unreadCount: 0 }];
  const next = [
    { chatId: '20', href: '/chat/20', unread: false, unreadCount: 0 },
    { chatId: '10', href: '/chat/10', unread: true, unreadCount: 2 },
  ];
  const merged = mergeThreadsById(acc, next);
  assert.deepEqual(merged.map((t) => t.chatId), ['10', '20'], 'chatId=10 должен остаться первым (первое появление)');
});

test('mergeThreadsById: unread агрегируется через OR (прочитан → непрочитан = непрочитан)', () => {
  const acc = [{ chatId: '5', href: '/chat/5', unread: false, unreadCount: 0 }];
  const next = [{ chatId: '5', href: '/chat/5', unread: true, unreadCount: 3 }];
  const merged = mergeThreadsById(acc, next);
  assert.equal(merged[0].unread, true, 'если тред где-то помечен непрочитанным — сохраняем это');
});

test('mergeThreadsById: unreadCount агрегируется через max', () => {
  const acc = [{ chatId: '5', href: '/chat/5', unread: true, unreadCount: 7 }];
  const next = [{ chatId: '5', href: '/chat/5', unread: true, unreadCount: 3 }];
  const merged = mergeThreadsById(acc, next);
  assert.equal(merged[0].unreadCount, 7, 'unreadCount должен быть максимумом из снимков');
});

test('mergeThreadsById: элементы без chatId пропускаются', () => {
  const acc = [];
  const next = [
    { href: '/chat/x', unread: true, unreadCount: 1 },
    null,
    undefined,
    { chatId: '', href: '/chat/empty', unread: true, unreadCount: 1 },
    { chatId: '99', href: '/chat/99', unread: false, unreadCount: 0 },
  ];
  const merged = mergeThreadsById(acc, next);
  assert.equal(merged.length, 1, 'только элемент с truthy chatId должен попасть в результат');
  assert.equal(merged[0].chatId, '99');
});

test('mergeThreadsById: не-массив acc → трактуется как []', () => {
  const merged = mergeThreadsById(null, [{ chatId: '1', href: '/chat/1', unread: false, unreadCount: 0 }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].chatId, '1');
});

test('mergeThreadsById: не-массив next → возвращает acc без изменений', () => {
  const acc = [{ chatId: '1', href: '/chat/1', unread: false, unreadCount: 0 }];
  assert.deepEqual(mergeThreadsById(acc, null), acc);
  assert.deepEqual(mergeThreadsById(acc, undefined), acc);
  assert.deepEqual(mergeThreadsById(acc, 'строка'), acc);
  assert.deepEqual(mergeThreadsById(acc, 42), acc);
  assert.deepEqual(mergeThreadsById(acc, {}), acc);
});

test('mergeThreadsById: оба аргумента мусор → не бросает, возвращает []', () => {
  assert.deepEqual(mergeThreadsById(null, undefined), []);
  assert.deepEqual(mergeThreadsById(undefined, 'x'), []);
  assert.deepEqual(mergeThreadsById({}, null), []);
});
