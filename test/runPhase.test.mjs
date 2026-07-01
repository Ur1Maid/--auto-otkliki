import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_PHASES,
  ERROR_REASONS,
  normalizePhase,
  classifyErrorReason,
  formatPhase,
} from '../src/lib/runPhase.js';

// --- Константы ---

test('RUN_PHASES: канонические литералы фаз', () => {
  assert.equal(RUN_PHASES.COLLECTING, 'collecting');
  assert.equal(RUN_PHASES.SCORING, 'scoring');
  assert.equal(RUN_PHASES.APPLYING, 'applying');
  assert.equal(RUN_PHASES.DONE, 'done');
  assert.equal(RUN_PHASES.ERROR, 'error');
});

test('RUN_PHASES / ERROR_REASONS: заморожены (нельзя случайно мутировать)', () => {
  assert.ok(Object.isFrozen(RUN_PHASES));
  assert.ok(Object.isFrozen(ERROR_REASONS));
});

test('ERROR_REASONS: ожидаемые литералы', () => {
  assert.equal(ERROR_REASONS.TIMEOUT, 'timeout');
  assert.equal(ERROR_REASONS.NAVIGATION, 'navigation');
  assert.equal(ERROR_REASONS.NETWORK, 'network');
  assert.equal(ERROR_REASONS.DETACHED, 'detached');
  assert.equal(ERROR_REASONS.CLOSED, 'closed');
  assert.equal(ERROR_REASONS.UNKNOWN, 'unknown');
});

// --- normalizePhase ---

test('normalizePhase: распознаёт каждую каноническую фазу', () => {
  for (const phase of Object.values(RUN_PHASES)) {
    assert.equal(normalizePhase(phase), phase);
  }
});

test('normalizePhase: тримит и приводит регистр', () => {
  assert.equal(normalizePhase('  SCORING '), 'scoring');
  assert.equal(normalizePhase('Applying'), 'applying');
  assert.equal(normalizePhase('DONE'), 'done');
});

test('normalizePhase: неизвестное → дефолт scoring', () => {
  assert.equal(normalizePhase('review'), 'scoring');
  assert.equal(normalizePhase(''), 'scoring');
});

test('normalizePhase: кастомный fallback применяется только если валиден', () => {
  assert.equal(normalizePhase('xxx', RUN_PHASES.COLLECTING), 'collecting');
  // невалидный fallback → дефолт scoring
  assert.equal(normalizePhase('xxx', 'garbage'), 'scoring');
});

test('normalizePhase: не-строка / null / undefined → дефолт, не бросает', () => {
  assert.equal(normalizePhase(null), 'scoring');
  assert.equal(normalizePhase(undefined), 'scoring');
  assert.equal(normalizePhase(42), 'scoring');
  assert.equal(normalizePhase({}), 'scoring');
});

// --- classifyErrorReason ---

test('classifyErrorReason: TimeoutError → timeout', () => {
  const err = new Error('Timeout 30000ms exceeded.');
  err.name = 'TimeoutError';
  assert.equal(classifyErrorReason(err), 'timeout');
});

test('classifyErrorReason: сетевые ошибки → network', () => {
  assert.equal(classifyErrorReason(new Error('net::ERR_CONNECTION_RESET at https://hh.ru')), 'network');
  assert.equal(classifyErrorReason(new Error('fetch failed')), 'network');
  assert.equal(classifyErrorReason(new Error('ECONNRESET')), 'network');
});

test('classifyErrorReason: навигация → navigation', () => {
  assert.equal(classifyErrorReason(new Error('page.goto: navigation failed')), 'navigation');
});

test('classifyErrorReason: отвалившийся узел → detached', () => {
  assert.equal(classifyErrorReason(new Error('Element is not attached to the DOM')), 'detached');
});

test('classifyErrorReason: закрытый таргет → closed', () => {
  assert.equal(
    classifyErrorReason(new Error('Target page, context or browser has been closed')),
    'closed',
  );
});

test('classifyErrorReason: нераспознанное → unknown', () => {
  assert.equal(classifyErrorReason(new Error('что-то пошло не так')), 'unknown');
  assert.equal(classifyErrorReason(''), 'unknown');
  assert.equal(classifyErrorReason(null), 'unknown');
  assert.equal(classifyErrorReason(undefined), 'unknown');
  assert.equal(classifyErrorReason(123), 'unknown');
  assert.equal(classifyErrorReason({ message: 'timeout' }), 'unknown'); // не-Error объект не строкуется
});

// --- БЕЗОПАСНОСТЬ: сырой текст исключения (PII/URL) НИКОГДА не возвращается ---

test('classifyErrorReason: PII/URL из сообщения не утекает в результат', () => {
  const secretUrl = 'https://hh.ru/vacancy/12345?token=SECRET&email=user@example.com';
  const err = new Error(`Timeout 30000ms exceeded while waiting on ${secretUrl}`);
  const reason = classifyErrorReason(err);
  // результат — только литерал, ни URL, ни токена, ни почты
  assert.equal(reason, 'timeout');
  assert.ok(!reason.includes('hh.ru'));
  assert.ok(!reason.includes('SECRET'));
  assert.ok(!reason.includes('@'));
  assert.ok(Object.values(ERROR_REASONS).includes(reason));
});

test('classifyErrorReason: всегда возвращает литерал из ERROR_REASONS', () => {
  const inputs = [
    new Error('net::ERR_X'),
    new Error('detached'),
    new Error('Target closed'),
    new Error('random'),
    'plain string timeout',
    null,
    {},
    42,
  ];
  for (const input of inputs) {
    assert.ok(Object.values(ERROR_REASONS).includes(classifyErrorReason(input)));
  }
});

// --- formatPhase ---

test('formatPhase: collecting со счётчиком и без', () => {
  assert.equal(formatPhase({ phase: 'collecting', index: 0, total: 250 }), 'Собирает вакансии: 250');
  // пул ещё не собран (total нет) — берём index как количество собранных
  assert.equal(formatPhase({ phase: 'collecting', index: 42, total: null }), 'Собирает вакансии: 42');
  // ничего ещё не собрано — без числа
  assert.equal(formatPhase({ phase: 'collecting', index: 0, total: null }), 'Собирает вакансии…');
});

test('formatPhase: scoring/applying показывают прогресс i/total', () => {
  assert.equal(formatPhase({ phase: 'scoring', index: 12, total: 40 }), 'Оценивает 12/40');
  assert.equal(formatPhase({ phase: 'applying', index: 12, total: 40 }), 'Откликается 12/40');
  // нет прогресса → с многоточием
  assert.equal(formatPhase({ phase: 'scoring' }), 'Оценивает…');
  assert.equal(formatPhase({ phase: 'applying', index: 5, total: 0 }), 'Откликается…');
});

test('formatPhase: done → Готово', () => {
  assert.equal(formatPhase({ phase: 'done', index: 40, total: 40 }), 'Готово');
});

test('formatPhase: done + исход сообщений → понятная метка (M18.5)', () => {
  assert.equal(formatPhase({ phase: 'done', lastEvent: 'chat_not_found' }), 'Чат не найден');
  assert.equal(formatPhase({ phase: 'done', lastEvent: 'no_new' }), 'Нет новых сообщений');
  assert.equal(formatPhase({ phase: 'done', lastEvent: 'processed' }), 'Готово');
  // apply-done несёт lastEvent='finished' (не исход сообщений) → нейтральное «Готово»
  assert.equal(formatPhase({ phase: 'done', lastEvent: 'finished' }), 'Готово');
});

test('formatPhase: error → «Ошибка: <русская причина>»', () => {
  assert.equal(formatPhase({ phase: 'error', lastEvent: 'timeout' }), 'Ошибка: таймаут');
  assert.equal(formatPhase({ phase: 'error', lastEvent: 'network' }), 'Ошибка: сеть');
  assert.equal(formatPhase({ phase: 'error', lastEvent: 'closed' }), 'Ошибка: браузер закрыт');
  // нераспознанная/пустая причина → «неизвестно»
  assert.equal(formatPhase({ phase: 'error', lastEvent: 'нечто' }), 'Ошибка: неизвестно');
  assert.equal(formatPhase({ phase: 'error' }), 'Ошибка: неизвестно');
});

test('ERROR_REASONS: auth/empty литералы для причин сбора (M18.3)', () => {
  assert.equal(ERROR_REASONS.AUTH, 'auth');
  assert.equal(ERROR_REASONS.EMPTY, 'empty');
});

test('formatPhase: auth/empty (M18.3) → понятная фраза без префикса «Ошибка:»', () => {
  // Разлогин и пустой поиск — конкретные причины «таймаута» сбора; панель показывает
  // их прямой фразой, а не общим «Ошибка: таймаут».
  assert.equal(formatPhase({ phase: 'error', lastEvent: 'auth' }), 'Нужен вход в аккаунт');
  assert.equal(formatPhase({ phase: 'error', lastEvent: 'empty' }), 'Поиск пуст');
  // регистр/пробелы lastEvent нормализуются как у прочих причин
  assert.equal(formatPhase({ phase: 'error', lastEvent: ' AUTH ' }), 'Нужен вход в аккаунт');
  assert.equal(formatPhase({ phase: 'error', lastEvent: 'EMPTY' }), 'Поиск пуст');
});

test('formatPhase: captcha (state) важнее любой фазы', () => {
  assert.equal(formatPhase({ phase: 'applying', index: 5, total: 10, state: 'captcha' }), 'Капча');
  assert.equal(formatPhase({ phase: 'collecting', state: 'captcha' }), 'Капча');
});

test('formatPhase: limit (state) важнее любой фазы → «Лимит откликов» (M14.3)', () => {
  assert.equal(formatPhase({ phase: 'applying', index: 5, total: 10, state: 'limit' }), 'Лимит откликов');
  assert.equal(formatPhase({ phase: 'scoring', state: 'limit' }), 'Лимит откликов');
});

test('formatPhase: logged_out (state) важнее любой фазы → «Сессия разлогинена — нужен вход» (M19.1)', () => {
  assert.equal(
    formatPhase({ phase: 'collecting', index: 0, total: 0, state: 'logged_out' }),
    'Сессия разлогинена — нужен вход',
  );
  assert.equal(formatPhase({ phase: 'scoring', state: 'logged_out' }), 'Сессия разлогинена — нужен вход');
});

test('formatPhase: captcha/limit важнее logged_out (M19.1)', () => {
  assert.equal(formatPhase({ state: 'captcha' }), 'Капча');
  assert.equal(formatPhase({ state: 'limit' }), 'Лимит откликов');
});

test('formatPhase: неизвестная/пустая фаза → Простаивает', () => {
  assert.equal(formatPhase({ phase: '' }), 'Простаивает');
  assert.equal(formatPhase({ phase: 'review' }), 'Простаивает');
  assert.equal(formatPhase({}), 'Простаивает');
});

test('formatPhase: мусор/не-объект не бросает', () => {
  assert.equal(formatPhase(null), 'Простаивает');
  assert.equal(formatPhase(undefined), 'Простаивает');
  assert.equal(formatPhase(42), 'Простаивает');
  assert.equal(formatPhase('collecting'), 'Простаивает');
});

test('formatPhase: PII из lastEvent не утекает (только метка причины)', () => {
  // lastEvent в error-хартбите — литерал classifyErrorReason; даже если туда попадёт мусор
  // с URL, formatPhase сводит к фиксированной метке (не эхо-ит вход).
  const out = formatPhase({ phase: 'error', lastEvent: 'https://hh.ru/vacancy/1?token=SECRET' });
  assert.equal(out, 'Ошибка: неизвестно');
  assert.ok(!out.includes('hh.ru'));
  assert.ok(!out.includes('SECRET'));
});
