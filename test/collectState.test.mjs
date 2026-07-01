import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectCollectProblem,
  collectProblemHeartbeat,
  LOGGED_OUT_PATTERNS,
  LOGIN_URL_PATTERNS,
  EMPTY_SEARCH_PATTERNS,
  COLLECT_OK,
  COLLECT_LOGGED_OUT,
  COLLECT_EMPTY_SEARCH,
  HEARTBEAT_STATE_LOGGED_OUT,
  HEARTBEAT_STATE_OK,
} from '../src/lib/collectState.js';
import { ERROR_REASONS } from '../src/lib/runPhase.js';

// --- паттерны экспортируются непустыми массивами ---

test('паттерны экспортируются непустыми массивами', () => {
  assert.ok(Array.isArray(LOGGED_OUT_PATTERNS) && LOGGED_OUT_PATTERNS.length > 0);
  assert.ok(Array.isArray(LOGIN_URL_PATTERNS) && LOGIN_URL_PATTERNS.length > 0);
  assert.ok(Array.isArray(EMPTY_SEARCH_PATTERNS) && EMPTY_SEARCH_PATTERNS.length > 0);
});

test('литералы состояния', () => {
  assert.equal(COLLECT_OK, 'ok');
  assert.equal(COLLECT_LOGGED_OUT, 'logged_out');
  assert.equal(COLLECT_EMPTY_SEARCH, 'empty_search');
});

// --- logged_out по тексту ---

test('detectCollectProblem: "Войдите в аккаунт" → logged_out', () => {
  assert.equal(detectCollectProblem('Войдите в аккаунт, чтобы откликаться'), 'logged_out');
});

test('detectCollectProblem: "Войдите, чтобы" → logged_out', () => {
  assert.equal(detectCollectProblem('Войдите, чтобы продолжить'), 'logged_out');
});

test('detectCollectProblem: "Вход в аккаунт" → logged_out', () => {
  assert.equal(detectCollectProblem('Вход в аккаунт соискателя'), 'logged_out');
});

test('detectCollectProblem: "Авторизуйтесь" → logged_out', () => {
  assert.equal(detectCollectProblem('Авторизуйтесь для доступа к вакансиям'), 'logged_out');
});

test('detectCollectProblem: регистронезависимость → logged_out', () => {
  assert.equal(detectCollectProblem('ВОЙДИТЕ В АККАУНТ'), 'logged_out');
});

// --- logged_out по URL ---

test('detectCollectProblem: URL /account/login → logged_out', () => {
  assert.equal(
    detectCollectProblem({ text: '', url: 'https://hh.ru/account/login?backurl=%2F' }),
    'logged_out',
  );
});

test('detectCollectProblem: URL /auth/login → logged_out', () => {
  assert.equal(detectCollectProblem({ url: 'https://hh.ru/auth/login' }), 'logged_out');
});

test('detectCollectProblem: обычный URL поиска (не логин) → ok', () => {
  assert.equal(
    detectCollectProblem({ text: 'Найдено 250 вакансий', url: 'https://hh.ru/search/vacancy' }),
    'ok',
  );
});

// --- empty_search ---

test('detectCollectProblem: "По вашему запросу ничего не найдено" → empty_search', () => {
  assert.equal(
    detectCollectProblem('По вашему запросу ничего не найдено. Попробуйте изменить запрос.'),
    'empty_search',
  );
});

test('detectCollectProblem: "Ничего не найдено" → empty_search', () => {
  assert.equal(detectCollectProblem('Ничего не найдено'), 'empty_search');
});

test('detectCollectProblem: "Вакансий не найдено" → empty_search', () => {
  assert.equal(detectCollectProblem('К сожалению, вакансий не найдено'), 'empty_search');
});

// --- приоритет logged_out > empty_search ---

test('detectCollectProblem: разлогин важнее пустого поиска (приоритет)', () => {
  const text = 'Войдите в аккаунт. По вашему запросу ничего не найдено.';
  assert.equal(detectCollectProblem(text), 'logged_out');
});

test('detectCollectProblem: URL логина важнее текста пустого поиска', () => {
  assert.equal(
    detectCollectProblem({ text: 'Ничего не найдено', url: 'https://hh.ru/account/login' }),
    'logged_out',
  );
});

// --- ok на нормальной странице поиска ---

test('detectCollectProblem: нормальная страница поиска → ok', () => {
  const text = [
    'Найдено 250 вакансий',
    'Senior DevOps Engineer · Москва · от 250 000 ₽',
    'Откликнуться',
  ].join('\n');
  assert.equal(detectCollectProblem(text), 'ok');
});

test('detectCollectProblem: страница вакансии со словом "найдено" в др. контексте → ok', () => {
  assert.equal(detectCollectProblem('Решение найдено в команде, опыт работы 3 года'), 'ok');
});

// --- never-throws на мусоре ---

test('detectCollectProblem: пустая строка → ok', () => {
  assert.equal(detectCollectProblem(''), 'ok');
});

test('detectCollectProblem: null → ok', () => {
  assert.equal(detectCollectProblem(null), 'ok');
});

test('detectCollectProblem: undefined → ok', () => {
  assert.equal(detectCollectProblem(undefined), 'ok');
});

test('detectCollectProblem: число → ok', () => {
  assert.equal(detectCollectProblem(42), 'ok');
});

test('detectCollectProblem: объект без text/url → ok', () => {
  assert.equal(detectCollectProblem({ foo: 'войдите в аккаунт' }), 'ok');
});

test('detectCollectProblem: объект с нестроковыми text/url → ok', () => {
  assert.equal(detectCollectProblem({ text: 123, url: {} }), 'ok');
});

// --- collectProblemHeartbeat: маппер причины сбора в поля heartbeat (M19.2) ---

test('литералы state heartbeat совпадают с литералами сбора (без дрейфа)', () => {
  assert.equal(HEARTBEAT_STATE_LOGGED_OUT, COLLECT_LOGGED_OUT);
  assert.equal(HEARTBEAT_STATE_OK, COLLECT_OK);
  assert.equal(HEARTBEAT_STATE_LOGGED_OUT, 'logged_out');
});

test('collectProblemHeartbeat: logged_out → auth + state logged_out', () => {
  assert.deepEqual(collectProblemHeartbeat(COLLECT_LOGGED_OUT), {
    lastEvent: ERROR_REASONS.AUTH,
    state: 'logged_out',
  });
});

test('collectProblemHeartbeat: empty_search → empty + state ok', () => {
  assert.deepEqual(collectProblemHeartbeat(COLLECT_EMPTY_SEARCH), {
    lastEvent: ERROR_REASONS.EMPTY,
    state: 'ok',
  });
});

test('collectProblemHeartbeat: ok → timeout + state ok (причину не вскрыли)', () => {
  assert.deepEqual(collectProblemHeartbeat(COLLECT_OK), {
    lastEvent: ERROR_REASONS.TIMEOUT,
    state: 'ok',
  });
});

test('collectProblemHeartbeat: неизвестный/мусорный вход → timeout + state ok', () => {
  for (const junk of ['whatever', '', null, undefined, 42, {}]) {
    assert.deepEqual(collectProblemHeartbeat(junk), {
      lastEvent: ERROR_REASONS.TIMEOUT,
      state: 'ok',
    });
  }
});

test('collectProblemHeartbeat: только logged_out несёт нейтральный «зависший» state', () => {
  // Инвариант M19.1: разлогин важнее stalled (state='logged_out'); пустой поиск и таймаут
  // — обычные исходы (state='ok'), не должны маскироваться под разлогин.
  assert.equal(collectProblemHeartbeat(COLLECT_LOGGED_OUT).state, 'logged_out');
  assert.equal(collectProblemHeartbeat(COLLECT_EMPTY_SEARCH).state, 'ok');
  assert.equal(collectProblemHeartbeat(COLLECT_OK).state, 'ok');
});
