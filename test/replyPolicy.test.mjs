import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideReply,
  looksLikeQuestion,
  SYSTEM_AUTO_PATTERNS,
  INVITATION_PATTERNS,
} from '../src/lib/replyPolicy.js';

// ---------------------------------------------------------------------------
// Вспомогательные сборщики массивов сообщений
// ---------------------------------------------------------------------------

function msgs(...items) {
  // items: [['employer'|'applicant', 'текст'], ...]
  return items.map(([author, text], i) => ({ msgId: String(i + 1), author, text }));
}

// ---------------------------------------------------------------------------
// decideReply — граничные/защитные случаи
// ---------------------------------------------------------------------------

test('decideReply: не массив → skip', () => {
  assert.equal(decideReply(null).action, 'skip');
  assert.equal(decideReply(undefined).action, 'skip');
  assert.equal(decideReply('строка').action, 'skip');
  assert.equal(decideReply(42).action, 'skip');
  assert.equal(decideReply({}).action, 'skip');
});

test('decideReply: пустой массив → skip', () => {
  const r = decideReply([]);
  assert.equal(r.action, 'skip');
  assert.ok(r.reason.length > 0, 'reason не должен быть пустым');
});

test('decideReply: битый null-элемент не роняет (не бросает)', () => {
  // null в конце массива — последнее сообщение «битое»
  assert.doesNotThrow(() => decideReply([{ author: 'employer', text: 'Подскажите телефон?' }, null]));
  // вопрос работодателя сохраняется как последний валидный employer → needs_model
  const r = decideReply([{ author: 'employer', text: 'Подскажите телефон?' }, null]);
  assert.equal(r.action, 'needs_model');
});

test('decideReply: не-объектные элементы пропускаются без падения', () => {
  assert.doesNotThrow(() => decideReply([null, undefined, 'строка', 42]));
  assert.equal(decideReply([null, undefined, 'строка', 42]).action, 'skip');
});

// ---------------------------------------------------------------------------
// Ветка: последнее сообщение — наше (applicant)
// ---------------------------------------------------------------------------

test('decideReply: последнее сообщение applicant → skip', () => {
  const r = decideReply(msgs(['employer', 'Здравствуйте!'], ['applicant', 'Спасибо, жду!']));
  assert.equal(r.action, 'skip');
  assert.ok(r.reason.includes('ждём'), r.reason);
});

test('decideReply: единственное сообщение applicant → skip', () => {
  const r = decideReply(msgs(['applicant', 'Без сопроводительного письма']));
  assert.equal(r.action, 'skip');
});

// ---------------------------------------------------------------------------
// Ветка: нет входящих (только applicant-сообщения)
// ---------------------------------------------------------------------------

test('decideReply: только applicant-сообщения → skip "нет входящих"', () => {
  const r = decideReply(msgs(
    ['applicant', 'Привет'],
    ['applicant', 'Хочу узнать статус'],
  ));
  // Последнее тоже applicant → уходит по ветке 2 «последнее наше»
  assert.equal(r.action, 'skip');
});

test('decideReply: принудительный тест ветки "нет входящих" — employer с пустым автором', () => {
  // Собираем: последнее НЕ applicant, но входящих employer нет
  // Симулируем тред где последнее сообщение unknown-автора (не employer, не applicant)
  const messages = [
    { msgId: '1', author: 'system', text: 'служебная запись' },
  ];
  // author !== 'applicant' (ветка 2 не срабатывает), employer не найден → ветка 3
  const r = decideReply(messages);
  assert.equal(r.action, 'skip');
  assert.equal(r.reason, 'нет входящих сообщений');
});

// ---------------------------------------------------------------------------
// Ветка: системные/авто-сообщения → skip
// ---------------------------------------------------------------------------

test('decideReply: инфо-бабл "У работодателя 2 отзыва и рейтинг 5.0" → skip', () => {
  const r = decideReply(msgs(['employer', 'У работодателя 2 отзыва и рейтинг 5.0']));
  assert.equal(r.action, 'skip');
  assert.equal(r.reason, 'системное/авто-сообщение');
});

test('decideReply: "Ваш отклик доставлен" → skip', () => {
  const r = decideReply(msgs(['employer', 'Ваш отклик доставлен работодателю.']));
  assert.equal(r.action, 'skip');
  assert.equal(r.reason, 'системное/авто-сообщение');
});

test('decideReply: "Ваш отклик просмотрен" → skip', () => {
  const r = decideReply(msgs(['employer', 'Ваш отклик просмотрен']));
  assert.equal(r.action, 'skip');
  assert.equal(r.reason, 'системное/авто-сообщение');
});

test('decideReply: "Ваш отклик отправлен" → skip', () => {
  const r = decideReply(msgs(['employer', 'Ваш отклик отправлен на рассмотрение']));
  assert.equal(r.action, 'skip');
  assert.equal(r.reason, 'системное/авто-сообщение');
});

test('decideReply: "Резюме просмотрено" → skip', () => {
  const r = decideReply(msgs(['employer', 'Ваше резюме просмотрено менеджером.']));
  assert.equal(r.action, 'skip');
  assert.equal(r.reason, 'системное/авто-сообщение');
});

test('decideReply: "Это автоматическое сообщение" → skip', () => {
  const r = decideReply(msgs(['employer', 'Это автоматическое уведомление от системы.']));
  assert.equal(r.action, 'skip');
  assert.equal(r.reason, 'системное/авто-сообщение');
});

// ---------------------------------------------------------------------------
// Ветка: вопрос → needs_model
// ---------------------------------------------------------------------------

test('decideReply: "Подскажите ваш телефон?" → needs_model', () => {
  const r = decideReply(msgs(['employer', 'Подскажите ваш телефон?']));
  assert.equal(r.action, 'needs_model');
  assert.equal(r.reason, 'вопрос работодателя');
});

test('decideReply: вопрос только по "?" → needs_model', () => {
  const r = decideReply(msgs(['employer', 'Когда вы готовы приступить?']));
  assert.equal(r.action, 'needs_model');
});

test('decideReply: "Пришлите номер телефона" (без "?") → needs_model', () => {
  const r = decideReply(msgs(['employer', 'Пришлите номер телефона для связи']));
  assert.equal(r.action, 'needs_model');
  assert.equal(r.reason, 'вопрос работодателя');
});

test('decideReply: "Подскажите, удобно ли вам" → needs_model', () => {
  const r = decideReply(msgs(['employer', 'Подскажите, удобно ли вам созвониться завтра']));
  assert.equal(r.action, 'needs_model');
});

// ---------------------------------------------------------------------------
// Ветка: приглашение без вопроса → needs_model (черновик ответа)
// ---------------------------------------------------------------------------

test('decideReply: "Приглашаем вас на собеседование" → needs_model', () => {
  const r = decideReply(msgs(['employer', 'Приглашаем вас на собеседование в наш офис.']));
  assert.equal(r.action, 'needs_model');
  assert.equal(r.reason, 'приглашение — черновик ответа');
});

test('decideReply: "Ждём вас в офисе" → needs_model', () => {
  const r = decideReply(msgs(['employer', 'Ждём вас в офисе в пятницу в 10:00']));
  assert.equal(r.action, 'needs_model');
  assert.equal(r.reason, 'приглашение — черновик ответа');
});

// ---------------------------------------------------------------------------
// Приглашение С вопросом → needs_model (вопрос приоритетнее приглашения)
// ---------------------------------------------------------------------------

test('decideReply: "Приглашаем на собеседование, когда удобно?" → needs_model', () => {
  const r = decideReply(msgs(
    ['employer', 'Приглашаем на собеседование, когда вам удобно?'],
  ));
  assert.equal(r.action, 'needs_model', 'вопрос приоритетнее приглашения');
  assert.equal(r.reason, 'вопрос работодателя');
});

test('decideReply: "На интервью — пришлите удобное время" → needs_model', () => {
  // Содержит и приглашение (на интервью), и просьбу (пришлите)
  const r = decideReply(msgs(['employer', 'Хотели бы пригласить вас на интервью, пришлите удобное время']));
  assert.equal(r.action, 'needs_model', 'пришлите — вопросный маркер, приоритет над приглашением');
});

// ---------------------------------------------------------------------------
// Ветка: нейтральное/неоднозначное → needs_model (черновик ответа)
// ---------------------------------------------------------------------------

test('decideReply: "Здравствуйте!" (нейтральное) → needs_model', () => {
  const r = decideReply(msgs(['employer', 'Здравствуйте!']));
  assert.equal(r.action, 'needs_model');
  assert.equal(r.reason, 'неоднозначно — черновик ответа');
});

test('decideReply: "Никита, здравствуйте!" (приветствие) → needs_model', () => {
  const r = decideReply(msgs(['employer', 'Никита, здравствуйте!']));
  assert.equal(r.action, 'needs_model');
  assert.equal(r.reason, 'неоднозначно — черновик ответа');
});

test('decideReply: "Спасибо за отклик, мы свяжемся позднее" → needs_model', () => {
  const r = decideReply(msgs(['employer', 'Спасибо за отклик, мы свяжемся с вами позднее.']));
  assert.equal(r.action, 'needs_model');
});

// ---------------------------------------------------------------------------
// decideReply: порядок и контекст (только последнее входящее учитывается)
// ---------------------------------------------------------------------------

test('decideReply: более ранний вопрос + последнее входящее без вопроса → needs_model', () => {
  // Работодатель сначала спросил, потом написал нейтрально — учитываем последнее
  const r = decideReply(msgs(
    ['employer', 'Подскажите ваш телефон?'],
    ['applicant', '+7 999 123-45-67'],
    ['employer', 'Спасибо, ждём вас завтра.'],
  ));
  // Последнее employer-сообщение «Спасибо, ждём вас завтра.» — приглашение
  assert.equal(r.action, 'needs_model');
  assert.equal(r.reason, 'приглашение — черновик ответа');
});

test('decideReply: тред с 3 сообщениями, последнее employer-вопрос → needs_model', () => {
  const r = decideReply(msgs(
    ['applicant', 'Без сопроводительного письма'],
    ['employer', 'Никита, здравствуйте!'],
    ['employer', 'Подскажите, когда вам удобно созвониться?'],
  ));
  assert.equal(r.action, 'needs_model');
});

// ---------------------------------------------------------------------------
// looksLikeQuestion
// ---------------------------------------------------------------------------

test('looksLikeQuestion: текст с "?" → true', () => {
  assert.equal(looksLikeQuestion('Когда вам удобно?'), true);
});

test('looksLikeQuestion: "подскажите …" → true', () => {
  assert.equal(looksLikeQuestion('Подскажите ваш email'), true);
});

test('looksLikeQuestion: "пришлите номер телефона" → true', () => {
  assert.equal(looksLikeQuestion('Пришлите номер телефона'), true);
});

test('looksLikeQuestion: "уточните детали" → true', () => {
  assert.equal(looksLikeQuestion('Уточните детали опыта'), true);
});

test('looksLikeQuestion: "напишите, когда сможете" → true', () => {
  assert.equal(looksLikeQuestion('Напишите когда сможете выйти'), true);
});

test('looksLikeQuestion: "расскажите о себе" → true', () => {
  assert.equal(looksLikeQuestion('Расскажите о своём опыте'), true);
});

test('looksLikeQuestion: "есть ли у вас опыт" → true', () => {
  assert.equal(looksLikeQuestion('Есть ли у вас опыт с Kubernetes?'), true);
});

test('looksLikeQuestion: утвердительное без вопросного знака → false', () => {
  assert.equal(looksLikeQuestion('Спасибо за отклик, мы свяжемся позднее'), false);
});

test('looksLikeQuestion: "Здравствуйте!" → false', () => {
  assert.equal(looksLikeQuestion('Здравствуйте!'), false);
});

test('looksLikeQuestion: приглашение без вопроса → false', () => {
  assert.equal(looksLikeQuestion('Приглашаем вас на собеседование в офис'), false);
});

test('looksLikeQuestion: пустая строка → false', () => {
  assert.equal(looksLikeQuestion(''), false);
});

test('looksLikeQuestion: не строка → false', () => {
  assert.equal(looksLikeQuestion(null), false);
  assert.equal(looksLikeQuestion(undefined), false);
  assert.equal(looksLikeQuestion(42), false);
});

// ---------------------------------------------------------------------------
// Экспортируемые константы паттернов — базовая проверка
// ---------------------------------------------------------------------------

test('SYSTEM_AUTO_PATTERNS: массив регэкспов, не пуст', () => {
  assert.ok(Array.isArray(SYSTEM_AUTO_PATTERNS));
  assert.ok(SYSTEM_AUTO_PATTERNS.length > 0);
  for (const p of SYSTEM_AUTO_PATTERNS) {
    assert.ok(p instanceof RegExp, `ожидается RegExp, got ${typeof p}`);
  }
});

test('INVITATION_PATTERNS: массив регэкспов, не пуст', () => {
  assert.ok(Array.isArray(INVITATION_PATTERNS));
  assert.ok(INVITATION_PATTERNS.length > 0);
  for (const p of INVITATION_PATTERNS) {
    assert.ok(p instanceof RegExp, `ожидается RegExp, got ${typeof p}`);
  }
});
