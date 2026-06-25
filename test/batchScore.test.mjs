import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBatchScoreMessages, scoreVacanciesBatch } from '../src/lib/batchScore.js';

// ---------------------------------------------------------------------------
// Вспомогательный мок callDeepSeek
// ---------------------------------------------------------------------------

function makeMock(response) {
  let callCount = 0;
  const fn = async (_args) => {
    callCount++;
    return response;
  };
  fn.callCount = () => callCount;
  return fn;
}

// ---------------------------------------------------------------------------
// buildBatchScoreMessages — структура
// ---------------------------------------------------------------------------

test('buildBatchScoreMessages: возвращает массив [system, user]', () => {
  const msgs = buildBatchScoreMessages(
    [{ id: '1', title: 'DevOps', text: 'Требования: Docker' }],
    'Роль: DevOps\nНавыки: Docker',
  );
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[1].role, 'user');
});

test('buildBatchScoreMessages: system требует JSON {"results":[...]}', () => {
  const [system] = buildBatchScoreMessages([], '');
  assert.ok(
    system.content.includes('"results"'),
    `system должен содержать "results": ${system.content}`,
  );
  assert.ok(
    system.content.includes('"id"'),
    `system должен содержать "id": ${system.content}`,
  );
});

test('buildBatchScoreMessages: system требует по одному элементу на вакансию', () => {
  const [system] = buildBatchScoreMessages([], '');
  assert.ok(
    system.content.includes('по одному элементу на вакансию'),
    `system должен требовать по одному элементу: ${system.content}`,
  );
});

test('buildBatchScoreMessages: system содержит запрет выдумывать данные', () => {
  const [system] = buildBatchScoreMessages([], '');
  assert.ok(
    system.content.includes('Не выдумывай'),
    `system должен содержать honesty-гардрейл: ${system.content}`,
  );
});

test('buildBatchScoreMessages: user содержит профиль кандидата', () => {
  const profile = 'Роль: DevOps\nНавыки: Docker, k8s';
  const [, user] = buildBatchScoreMessages([], profile);
  assert.ok(user.content.includes(profile), `user должен содержать профиль: ${user.content}`);
});

test('buildBatchScoreMessages: user содержит id каждой вакансии', () => {
  const vacancies = [
    { id: 'v1', title: 'Инженер', text: 'Требования: Python' },
    { id: 'v2', title: 'Аналитик', text: 'Требования: SQL' },
  ];
  const [, user] = buildBatchScoreMessages(vacancies, '');
  assert.ok(user.content.includes('id=v1'), `нет id=v1: ${user.content}`);
  assert.ok(user.content.includes('id=v2'), `нет id=v2: ${user.content}`);
});

test('buildBatchScoreMessages: user содержит заголовок вакансии', () => {
  const vacancies = [{ id: 'x', title: 'Senior Backend Developer', text: '' }];
  const [, user] = buildBatchScoreMessages(vacancies, '');
  assert.ok(user.content.includes('Senior Backend Developer'), `нет заголовка: ${user.content}`);
});

test('buildBatchScoreMessages: user содержит усечённые требования (не полный text)', () => {
  // Если text начинается с раздела «Требования», extractRequirements его оставит
  const long = 'Требования: ' + 'Python '.repeat(300); // > 1500 символов
  const vacancies = [{ id: 'x', title: 'Dev', text: long }];
  const [, user] = buildBatchScoreMessages(vacancies, '');
  // Полный повтор 300×"Python " ≈ 2100 символов → усечётся до 1500
  assert.ok(user.content.length < long.length + 300, 'user слишком длинный, усечение не работает');
  assert.ok(user.content.includes('Python'), 'требования вообще не попали');
});

test('buildBatchScoreMessages: пустой массив вакансий — не бросает', () => {
  assert.doesNotThrow(() => buildBatchScoreMessages([], 'профиль'));
});

test('buildBatchScoreMessages: не-массив vacancies — не бросает, user не пустой', () => {
  assert.doesNotThrow(() => {
    const [, user] = buildBatchScoreMessages(null, '');
    assert.ok(typeof user.content === 'string');
  });
});

test('buildBatchScoreMessages: не-строки в полях вакансии приводятся к строке', () => {
  assert.doesNotThrow(() => {
    buildBatchScoreMessages([{ id: 42, title: null, text: undefined }], '');
  });
});

// ---------------------------------------------------------------------------
// scoreVacanciesBatch — основной кейс: один вызов на N, клампинг, порядок
// ---------------------------------------------------------------------------

test('scoreVacanciesBatch: валидный ответ → массив из N, callDeepSeek вызван РОВНО 1 раз', async () => {
  const vacancies = [
    { id: 'a', title: 'DevOps', text: 'Требования: Docker' },
    { id: 'b', title: 'Аналитик', text: 'Требования: SQL' },
  ];
  const content = JSON.stringify({ results: [
    { id: 'a', score: 80, reason: 'хороший матч' },
    { id: 'b', score: 10, reason: 'не подходит' },
  ]});
  const mock = makeMock({ ok: true, content });

  const results = await scoreVacanciesBatch(
    vacancies,
    { resumeProfile: 'Роль: DevOps', apiKey: 'key', apiUrl: 'u', model: 'm' },
    { callDeepSeek: mock },
  );

  // Один вызов на N — главная гарантия батч-подхода
  assert.equal(mock.callCount(), 1, 'callDeepSeek должен быть вызван ровно 1 раз');
  assert.equal(results.length, 2);
  assert.equal(results[0].id, 'a');
  assert.equal(results[0].score, 80);
  assert.equal(results[0].reason, 'хороший матч');
  assert.equal(results[1].id, 'b');
  assert.equal(results[1].score, 10);
});

test('scoreVacanciesBatch: порядок результата совпадает с порядком входных vacancies', async () => {
  const vacancies = [
    { id: 'z', title: 'Z', text: '' },
    { id: 'a', title: 'A', text: '' },
  ];
  // Модель отвечает в обратном порядке — выравниваем по входу
  const content = JSON.stringify({ results: [
    { id: 'a', score: 70, reason: 'r-a' },
    { id: 'z', score: 30, reason: 'r-z' },
  ]});
  const mock = makeMock({ ok: true, content });

  const results = await scoreVacanciesBatch(vacancies, { apiKey: 'key' }, { callDeepSeek: mock });

  assert.equal(results[0].id, 'z');
  assert.equal(results[0].score, 30);
  assert.equal(results[1].id, 'a');
  assert.equal(results[1].score, 70);
});

// ---------------------------------------------------------------------------
// scoreVacanciesBatch — клампинг score
// ---------------------------------------------------------------------------

test('scoreVacanciesBatch: score > 100 клампится в 100', async () => {
  const content = JSON.stringify({ results: [{ id: 'x', score: 150, reason: 'ok' }] });
  const mock = makeMock({ ok: true, content });

  const results = await scoreVacanciesBatch(
    [{ id: 'x', title: 'T', text: '' }],
    { apiKey: 'key' },
    { callDeepSeek: mock },
  );
  assert.equal(results[0].score, 100);
});

test('scoreVacanciesBatch: score < 0 клампится в 0', async () => {
  const content = JSON.stringify({ results: [{ id: 'x', score: -5, reason: 'ok' }] });
  const mock = makeMock({ ok: true, content });

  const results = await scoreVacanciesBatch(
    [{ id: 'x', title: 'T', text: '' }],
    { apiKey: 'key' },
    { callDeepSeek: mock },
  );
  assert.equal(results[0].score, 0);
});

test('scoreVacanciesBatch: нечисловой score → 0', async () => {
  const content = JSON.stringify({ results: [{ id: 'x', score: 'высокий', reason: 'ok' }] });
  const mock = makeMock({ ok: true, content });

  const results = await scoreVacanciesBatch(
    [{ id: 'x', title: 'T', text: '' }],
    { apiKey: 'key' },
    { callDeepSeek: mock },
  );
  assert.equal(results[0].score, 0);
});

// ---------------------------------------------------------------------------
// scoreVacanciesBatch — missing и лишние id в ответе
// ---------------------------------------------------------------------------

test('scoreVacanciesBatch: id отсутствует в ответе модели → missing_in_batch, score 0', async () => {
  const content = JSON.stringify({ results: [
    { id: 'a', score: 80, reason: 'ok' },
    // 'b' пропущен
  ]});
  const mock = makeMock({ ok: true, content });

  const results = await scoreVacanciesBatch(
    [{ id: 'a', title: 'A', text: '' }, { id: 'b', title: 'B', text: '' }],
    { apiKey: 'key' },
    { callDeepSeek: mock },
  );
  assert.equal(results[1].id, 'b');
  assert.equal(results[1].score, 0);
  assert.equal(results[1].reason, 'missing_in_batch');
  // missing_in_batch — не aiFailed (модель ответила, просто пропустила)
  assert.ok(!results[1].aiFailed, 'missing_in_batch не должен иметь aiFailed');
});

test('scoreVacanciesBatch: лишний id в ответе (не во входе) — игнорируется', async () => {
  const content = JSON.stringify({ results: [
    { id: 'known', score: 70, reason: 'ok' },
    { id: 'ghost',  score: 99, reason: 'лишний' },  // нет во входе
  ]});
  const mock = makeMock({ ok: true, content });

  const results = await scoreVacanciesBatch(
    [{ id: 'known', title: 'K', text: '' }],
    { apiKey: 'key' },
    { callDeepSeek: mock },
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'known');
  assert.equal(results[0].score, 70);
});

// ---------------------------------------------------------------------------
// scoreVacanciesBatch — битый JSON / некорректный ответ модели
// ---------------------------------------------------------------------------

test('scoreVacanciesBatch: битый JSON → все вакансии missing_in_batch, не бросает', async () => {
  const mock = makeMock({ ok: true, content: 'это не json вообще' });

  const call = scoreVacanciesBatch(
    [{ id: 'a', title: 'A', text: '' }, { id: 'b', title: 'B', text: '' }],
    { apiKey: 'key' },
    { callDeepSeek: mock },
  );
  await assert.doesNotReject(call);
  const results = await call;
  assert.equal(results.length, 2);
  assert.equal(results[0].score, 0);
  assert.equal(results[0].reason, 'missing_in_batch');
  assert.equal(results[1].score, 0);
  assert.equal(results[1].reason, 'missing_in_batch');
});

test('scoreVacanciesBatch: JSON без .results → все missing_in_batch, не бросает', async () => {
  const mock = makeMock({ ok: true, content: '{"other": 123}' });

  const call = scoreVacanciesBatch(
    [{ id: 'x', title: 'X', text: '' }],
    { apiKey: 'key' },
    { callDeepSeek: mock },
  );
  await assert.doesNotReject(call);
  const results = await call;
  assert.equal(results[0].score, 0);
  assert.equal(results[0].reason, 'missing_in_batch');
});

test('scoreVacanciesBatch: .results не массив → все missing_in_batch, не бросает', async () => {
  const mock = makeMock({ ok: true, content: '{"results": "не массив"}' });

  const call = scoreVacanciesBatch(
    [{ id: 'x', title: 'X', text: '' }],
    { apiKey: 'key' },
    { callDeepSeek: mock },
  );
  await assert.doesNotReject(call);
  const results = await call;
  assert.equal(results[0].reason, 'missing_in_batch');
});

test('scoreVacanciesBatch: примитивы в results не роняют ("id" in <примитив>)', async () => {
  // results содержит примитивы (5, "строка", null) рядом с валидным объектом
  const mock = makeMock({ ok: true, content: '{"results":[5,"x",null,{"id":"a","score":70,"reason":"ok"}]}' });
  const call = scoreVacanciesBatch(
    [{ id: 'a', title: 'A', text: '' }, { id: 'b', title: 'B', text: '' }],
    { apiKey: 'key' },
    { callDeepSeek: mock },
  );
  await assert.doesNotReject(call);
  const results = await call;
  assert.equal(results[0].score, 70, 'валидный объект распарсен');
  assert.equal(results[1].reason, 'missing_in_batch', 'b пропущен моделью');
});

// ---------------------------------------------------------------------------
// scoreVacanciesBatch — сбой API
// ---------------------------------------------------------------------------

test('scoreVacanciesBatch: !ok (402) → все aiFailed, reason deepseek_insufficient_balance, не бросает', async () => {
  const mock = makeMock({ ok: false, status: 402, body: 'insufficient balance' });

  const call = scoreVacanciesBatch(
    [{ id: 'a', title: 'A', text: '' }, { id: 'b', title: 'B', text: '' }],
    { apiKey: 'key' },
    { callDeepSeek: mock },
  );
  await assert.doesNotReject(call);
  const results = await call;
  assert.equal(results.length, 2);
  assert.equal(results[0].aiFailed, true);
  assert.equal(results[0].reason, 'deepseek_insufficient_balance');
  assert.equal(results[0].aiStatus, 402);
  assert.equal(results[1].aiFailed, true);
  assert.equal(results[1].reason, 'deepseek_insufficient_balance');
});

test('scoreVacanciesBatch: !ok (500) → reason relevance_check_failed', async () => {
  const mock = makeMock({ ok: false, status: 500, body: 'err' });

  const results = await scoreVacanciesBatch(
    [{ id: 'x', title: 'X', text: '' }],
    { apiKey: 'key' },
    { callDeepSeek: mock },
  );
  assert.equal(results[0].aiFailed, true);
  assert.equal(results[0].reason, 'relevance_check_failed');
  assert.equal(results[0].aiStatus, 500);
});

test('scoreVacanciesBatch: отклоняющийся callDeepSeek → все aiFailed, не бросает', async () => {
  const rejecting = async () => { throw new Error('network down'); };
  const call = scoreVacanciesBatch(
    [{ id: 'a', title: 'A', text: '' }, { id: 'b', title: 'B', text: '' }],
    { apiKey: 'key' },
    { callDeepSeek: rejecting },
  );
  await assert.doesNotReject(call, 'отклонение callDeepSeek не должно выходить наружу');
  const results = await call;
  assert.equal(results.length, 2);
  assert.equal(results[0].aiFailed, true);
  assert.equal(results[1].aiFailed, true);
});

// ---------------------------------------------------------------------------
// scoreVacanciesBatch — граничные случаи: пустой список, нет ключа
// ---------------------------------------------------------------------------

test('scoreVacanciesBatch: пустой vacancies → [], callDeepSeek не вызван', async () => {
  const mock = makeMock({ ok: true, content: '{"results":[]}' });

  const results = await scoreVacanciesBatch([], { apiKey: 'key' }, { callDeepSeek: mock });
  assert.deepEqual(results, []);
  assert.equal(mock.callCount(), 0, 'callDeepSeek не должен вызываться для пустого списка');
});

test('scoreVacanciesBatch: не-массив vacancies → [], callDeepSeek не вызван', async () => {
  const mock = makeMock({ ok: true, content: '{"results":[]}' });

  const results = await scoreVacanciesBatch(null, { apiKey: 'key' }, { callDeepSeek: mock });
  assert.deepEqual(results, []);
  assert.equal(mock.callCount(), 0);
});

test('scoreVacanciesBatch: !apiKey → все aiFailed, reason no_key, callDeepSeek не вызван', async () => {
  const mock = makeMock({ ok: true, content: '{"results":[]}' });
  const vacancies = [{ id: 'a', title: 'A', text: '' }, { id: 'b', title: 'B', text: '' }];

  const results = await scoreVacanciesBatch(vacancies, { apiKey: '' }, { callDeepSeek: mock });

  assert.equal(mock.callCount(), 0, 'callDeepSeek не должен вызываться без ключа');
  assert.equal(results.length, 2);
  assert.equal(results[0].aiFailed, true);
  assert.equal(results[0].reason, 'no_key');
  assert.equal(results[1].aiFailed, true);
  assert.equal(results[1].reason, 'no_key');
});

test('scoreVacanciesBatch: apiKey не передан → все aiFailed, callDeepSeek не вызван', async () => {
  const mock = makeMock({ ok: true, content: '{"results":[]}' });
  const vacancies = [{ id: 'x', title: 'X', text: '' }];

  const results = await scoreVacanciesBatch(vacancies, {}, { callDeepSeek: mock });

  assert.equal(mock.callCount(), 0);
  assert.equal(results[0].aiFailed, true);
  assert.equal(results[0].reason, 'no_key');
});

// ---------------------------------------------------------------------------
// scoreVacanciesBatch — reason усекается до 300 символов
// ---------------------------------------------------------------------------

test('scoreVacanciesBatch: reason длиннее 300 символов усекается', async () => {
  const longReason = 'x'.repeat(500);
  const content = JSON.stringify({ results: [{ id: 'x', score: 50, reason: longReason }] });
  const mock = makeMock({ ok: true, content });

  const results = await scoreVacanciesBatch(
    [{ id: 'x', title: 'X', text: '' }],
    { apiKey: 'key' },
    { callDeepSeek: mock },
  );
  assert.equal(results[0].reason.length, 300);
});

// ---------------------------------------------------------------------------
// scoreVacanciesBatch — maxTokens пропорционально N
// ---------------------------------------------------------------------------

test('scoreVacanciesBatch: callDeepSeek получает разумный maxTokens для 5 вакансий', async () => {
  let capturedArgs = null;
  const mock = async (args) => {
    capturedArgs = args;
    return {
      ok: true,
      content: JSON.stringify({ results: [
        { id: '1', score: 50, reason: 'ok' },
        { id: '2', score: 50, reason: 'ok' },
        { id: '3', score: 50, reason: 'ok' },
        { id: '4', score: 50, reason: 'ok' },
        { id: '5', score: 50, reason: 'ok' },
      ]}),
    };
  };

  const vacancies = [1, 2, 3, 4, 5].map((i) => ({ id: String(i), title: `V${i}`, text: '' }));
  await scoreVacanciesBatch(vacancies, { apiKey: 'key' }, { callDeepSeek: mock });

  assert.ok(capturedArgs !== null, 'callDeepSeek должен был вызваться');
  // 5 вакансий × 60 = 300; < 1200 → 300
  assert.equal(capturedArgs.maxTokens, 300, `ожидался maxTokens=300, получено ${capturedArgs.maxTokens}`);
});

test('scoreVacanciesBatch: maxTokens не превышает кэп 1200 для 30 вакансий', async () => {
  let capturedMaxTokens = null;
  const results30 = Array.from({ length: 30 }, (_, i) => ({
    id: String(i), score: 50, reason: 'ok',
  }));
  const mock = async (args) => {
    capturedMaxTokens = args.maxTokens;
    return { ok: true, content: JSON.stringify({ results: results30 }) };
  };

  const vacancies = results30.map((r, i) => ({ id: String(i), title: `V${i}`, text: '' }));
  await scoreVacanciesBatch(vacancies, { apiKey: 'key' }, { callDeepSeek: mock });

  assert.equal(capturedMaxTokens, 1200, `ожидался кэп 1200, получено ${capturedMaxTokens}`);
});
