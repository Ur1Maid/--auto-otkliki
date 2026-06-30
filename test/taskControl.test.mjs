import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskCommand, canStart } from '../src/lib/taskControl.js';
import { parseDaemonArgs } from '../src/lib/daemonArgs.js';

// Все тесты детерминированы: без IO, сети, Date.now().

// ============================================================
// buildTaskCommand — happy paths
// ============================================================

test('buildTaskCommand: apply с text/area/limit → корректный argv', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'myacc', text: 'DevOps', area: '1', limit: 50 });
  assert.ok(argv.includes('--task'), '--task должен присутствовать');
  assert.equal(argv[argv.indexOf('--task') + 1], 'apply');
  assert.equal(argv[argv.indexOf('--account') + 1], 'myacc');
  assert.equal(argv[argv.indexOf('--text') + 1], 'DevOps');
  assert.equal(argv[argv.indexOf('--area') + 1], '1');
  assert.equal(argv[argv.indexOf('--limit') + 1], '50');
});

test('buildTaskCommand: messages → корректный argv без text/area/limit', () => {
  const argv = buildTaskCommand({ task: 'messages', account: 'acc2' });
  assert.equal(argv[argv.indexOf('--task') + 1], 'messages');
  assert.equal(argv[argv.indexOf('--account') + 1], 'acc2');
  assert.ok(!argv.includes('--text'), '--text не должен быть для messages');
  assert.ok(!argv.includes('--area'), '--area не должен быть для messages');
  assert.ok(!argv.includes('--limit'), '--limit не должен быть для messages');
});

test('buildTaskCommand: resume → корректный argv без text/area/limit', () => {
  const argv = buildTaskCommand({ task: 'resume', account: 'acc3' });
  assert.equal(argv[argv.indexOf('--task') + 1], 'resume');
  assert.ok(!argv.includes('--text'));
  assert.ok(!argv.includes('--area'));
  assert.ok(!argv.includes('--limit'));
});

// ============================================================
// buildTaskCommand — инвариант безопасности live (КРИТИЧНО)
// ============================================================

test('buildTaskCommand: live по умолчанию → --live ОТСУТСТВУЕТ (КРИТИЧНО)', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc' });
  assert.ok(!argv.includes('--live'), 'live-режим требует явного live:true');
});

test('buildTaskCommand: live=false → --live ОТСУТСТВУЕТ (КРИТИЧНО)', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc', live: false });
  assert.ok(!argv.includes('--live'), 'live:false не должен давать --live');
});

test('buildTaskCommand: live=true → --live ПРИСУТСТВУЕТ (явный opt-in)', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc', live: true });
  assert.ok(argv.includes('--live'), 'live:true ДОЛЖЕН давать --live');
});

test('buildTaskCommand: live=true для messages → --live присутствует', () => {
  const argv = buildTaskCommand({ task: 'messages', account: 'acc', live: true });
  assert.ok(argv.includes('--live'));
});

test('buildTaskCommand: live=true для resume → --live присутствует', () => {
  const argv = buildTaskCommand({ task: 'resume', account: 'acc', live: true });
  assert.ok(argv.includes('--live'));
});

test('buildTaskCommand: live truthy-но-не-true (1) → --live ОТСУТСТВУЕТ (строгий === true)', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc', live: 1 });
  assert.ok(!argv.includes('--live'), 'только явный live===true даёт --live');
});

test('buildTaskCommand: live="yes" (строка) → --live ОТСУТСТВУЕТ', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc', live: 'yes' });
  assert.ok(!argv.includes('--live'));
});

// ============================================================
// buildTaskCommand — --reply-auto для messages ТОЛЬКО при live (M16.3)
// ============================================================

test('buildTaskCommand: messages live=true → --reply-auto ПРИСУТСТВУЕТ (авто-отправка ответов)', () => {
  const argv = buildTaskCommand({ task: 'messages', account: 'acc', live: true });
  assert.ok(argv.includes('--reply-auto'), 'live messages должны нести --reply-auto');
});

test('buildTaskCommand: messages live=false → --reply-auto ОТСУТСТВУЕТ (dry-run preview)', () => {
  const argv = buildTaskCommand({ task: 'messages', account: 'acc', live: false });
  assert.ok(!argv.includes('--reply-auto'), 'dry-run messages не авто-отправляют');
});

test('buildTaskCommand: messages по умолчанию (без live) → --reply-auto ОТСУТСТВУЕТ', () => {
  const argv = buildTaskCommand({ task: 'messages', account: 'acc' });
  assert.ok(!argv.includes('--reply-auto'));
});

test('buildTaskCommand: messages live truthy-но-не-true (1) → --reply-auto ОТСУТСТВУЕТ (строгий ===)', () => {
  const argv = buildTaskCommand({ task: 'messages', account: 'acc', live: 1 });
  assert.ok(!argv.includes('--reply-auto'), 'только явный live===true даёт --reply-auto');
});

test('buildTaskCommand: apply live=true → --reply-auto ОТСУТСТВУЕТ (флаг только для messages)', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc', live: true });
  assert.ok(!argv.includes('--reply-auto'), 'apply не использует --reply-auto');
});

test('buildTaskCommand: resume live=true → --reply-auto ОТСУТСТВУЕТ (флаг только для messages)', () => {
  const argv = buildTaskCommand({ task: 'resume', account: 'acc', live: true });
  assert.ok(!argv.includes('--reply-auto'), 'resume не использует --reply-auto');
});

test('buildTaskCommand: алиас poll live=true → --reply-auto ПРИСУТСТВУЕТ (нормализуется в messages)', () => {
  const argv = buildTaskCommand({ task: 'poll', account: 'acc', live: true });
  assert.ok(argv.includes('--reply-auto'), 'poll→messages live должен нести --reply-auto');
});

// Инвариант безопасности: --reply-auto НИКОГДА не появляется без --live (иначе авто-отправка
// могла бы быть включена в dry-run-режиме). Локаем связку против будущих правок.
test('buildTaskCommand: --reply-auto ⇒ --live (никогда не разъединены)', () => {
  for (const task of ['apply', 'messages', 'resume', 'poll']) {
    for (const live of [true, false, 1, 'yes', undefined]) {
      const argv = buildTaskCommand({ task, account: 'acc', live });
      if (argv.includes('--reply-auto')) {
        assert.ok(argv.includes('--live'), `--reply-auto без --live для task=${task}, live=${String(live)}`);
      }
    }
  }
});

// Round-trip: argv live messages → parseDaemonArgs → replyAuto:true, dryRun:false.
test('buildTaskCommand → parseDaemonArgs: live messages даёт replyAuto:true и dryRun:false', () => {
  const argv = buildTaskCommand({ task: 'messages', account: 'acc', live: true });
  const opts = parseDaemonArgs(argv);
  assert.equal(opts.task, 'messages');
  assert.equal(opts.replyAuto, true, 'live messages → авто-отправка включена');
  assert.equal(opts.dryRun, false, 'live → dry-run выключен');
});

test('buildTaskCommand → parseDaemonArgs: dry-run messages даёт replyAuto:false и dryRun:true', () => {
  const argv = buildTaskCommand({ task: 'messages', account: 'acc' });
  const opts = parseDaemonArgs(argv);
  assert.equal(opts.task, 'messages');
  assert.equal(opts.replyAuto, false, 'dry-run messages → авто-отправка выключена');
  assert.equal(opts.dryRun, true, 'дефолт dry-run');
});

// ============================================================
// buildTaskCommand — нормализация алиасов task
// ============================================================

test('buildTaskCommand: алиас poll → task=messages', () => {
  const argv = buildTaskCommand({ task: 'poll', account: 'acc' });
  assert.equal(argv[argv.indexOf('--task') + 1], 'messages');
});

test('buildTaskCommand: алиас bump → task=resume', () => {
  const argv = buildTaskCommand({ task: 'bump', account: 'acc' });
  assert.equal(argv[argv.indexOf('--task') + 1], 'resume');
});

test('buildTaskCommand: алиас micro-edit → task=resume', () => {
  const argv = buildTaskCommand({ task: 'micro-edit', account: 'acc' });
  assert.equal(argv[argv.indexOf('--task') + 1], 'resume');
});

test('buildTaskCommand: task в верхнем регистре (APPLY) → нормализуется в apply', () => {
  const argv = buildTaskCommand({ task: 'APPLY', account: 'acc' });
  assert.equal(argv[argv.indexOf('--task') + 1], 'apply');
});

test('buildTaskCommand: task POLL → нормализуется в messages', () => {
  const argv = buildTaskCommand({ task: 'POLL', account: 'acc' });
  assert.equal(argv[argv.indexOf('--task') + 1], 'messages');
});

test('buildTaskCommand: task BUMP → нормализуется в resume', () => {
  const argv = buildTaskCommand({ task: 'BUMP', account: 'acc' });
  assert.equal(argv[argv.indexOf('--task') + 1], 'resume');
});

// ============================================================
// buildTaskCommand — ошибки валидации
// ============================================================

test('buildTaskCommand: неизвестный task → бросает с Russian-сообщением', () => {
  assert.throws(
    () => buildTaskCommand({ task: 'wat', account: 'acc' }),
    /Параметр task должен быть одним из/,
  );
});

test('buildTaskCommand: пустой task → бросает', () => {
  assert.throws(
    () => buildTaskCommand({ task: '', account: 'acc' }),
    /Параметр task должен быть одним из/,
  );
});

test('buildTaskCommand: task=null → бросает', () => {
  assert.throws(
    () => buildTaskCommand({ task: null, account: 'acc' }),
    /Параметр task должен быть одним из/,
  );
});

test('buildTaskCommand: task=undefined → бросает', () => {
  assert.throws(
    () => buildTaskCommand({ task: undefined, account: 'acc' }),
    /Параметр task должен быть одним из/,
  );
});

test('buildTaskCommand: пустой account → бросает с Russian-сообщением', () => {
  assert.throws(
    () => buildTaskCommand({ task: 'apply', account: '' }),
    /Параметр account обязателен/,
  );
});

test('buildTaskCommand: account=null → бросает', () => {
  assert.throws(
    () => buildTaskCommand({ task: 'apply', account: null }),
    /Параметр account обязателен/,
  );
});

test('buildTaskCommand: account=undefined → бросает', () => {
  assert.throws(
    () => buildTaskCommand({ task: 'apply', account: undefined }),
    /Параметр account обязателен/,
  );
});

test('buildTaskCommand: account только пробелы → бросает', () => {
  assert.throws(
    () => buildTaskCommand({ task: 'apply', account: '   ' }),
    /Параметр account обязателен/,
  );
});

// ============================================================
// buildTaskCommand — limit/text/area игнорируются для messages/resume
// ============================================================

test('buildTaskCommand: messages с limit/text/area → игнорируются', () => {
  const argv = buildTaskCommand({ task: 'messages', account: 'acc', limit: 50, text: 'Go', area: '2' });
  assert.ok(!argv.includes('--limit'));
  assert.ok(!argv.includes('--text'));
  assert.ok(!argv.includes('--area'));
});

test('buildTaskCommand: resume с limit/text/area → игнорируются', () => {
  const argv = buildTaskCommand({ task: 'resume', account: 'acc', limit: 100, text: 'Java', area: '3' });
  assert.ok(!argv.includes('--limit'));
  assert.ok(!argv.includes('--text'));
  assert.ok(!argv.includes('--area'));
});

test('buildTaskCommand: apply limit=0 → --limit не добавляется', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc', limit: 0 });
  assert.ok(!argv.includes('--limit'), 'limit=0 не является положительным — не добавляется');
});

test('buildTaskCommand: apply limit отрицательный → --limit не добавляется', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc', limit: -5 });
  assert.ok(!argv.includes('--limit'));
});

test('buildTaskCommand: apply limit="abc" (мусор) → --limit не добавляется', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc', limit: 'abc' });
  assert.ok(!argv.includes('--limit'));
});

test('buildTaskCommand: apply limit=null → --limit не добавляется', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc', limit: null });
  assert.ok(!argv.includes('--limit'));
});

test('buildTaskCommand: apply text пустой → --text не добавляется', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc', text: '' });
  assert.ok(!argv.includes('--text'));
});

test('buildTaskCommand: apply text только пробелы → --text не добавляется', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc', text: '   ' });
  assert.ok(!argv.includes('--text'));
});

test('buildTaskCommand: apply area пустой → --area не добавляется', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc', area: '' });
  assert.ok(!argv.includes('--area'));
});

test('buildTaskCommand: apply area=null → --area не добавляется', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc', area: null });
  assert.ok(!argv.includes('--area'));
});

// ============================================================
// buildTaskCommand — порядок argv и trim аккаунта
// ============================================================

test('buildTaskCommand: --task идёт первым в argv', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc' });
  assert.equal(argv[0], '--task');
});

test('buildTaskCommand: --account идёт вторым в argv', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc' });
  assert.equal(argv[2], '--account');
});

test('buildTaskCommand: --live идёт последним при live:true', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc', live: true, limit: 10 });
  assert.equal(argv[argv.length - 1], '--live');
});

test('buildTaskCommand: account с пробелами обрезается', () => {
  const argv = buildTaskCommand({ task: 'apply', account: '  myacc  ' });
  assert.equal(argv[argv.indexOf('--account') + 1], 'myacc');
});

test('buildTaskCommand: apply limit="25" (строка) → --limit 25', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc', limit: '25' });
  assert.equal(argv[argv.indexOf('--limit') + 1], '25');
});

test('buildTaskCommand: apply limit=25.7 (дробное) → --limit 25 (floor до целого)', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc', limit: 25.7 });
  assert.equal(argv[argv.indexOf('--limit') + 1], '25');
});

test('buildTaskCommand: apply limit=0.5 → floor 0 < 1 → --limit не добавляется', () => {
  const argv = buildTaskCommand({ task: 'apply', account: 'acc', limit: 0.5 });
  assert.ok(!argv.includes('--limit'));
});

// ============================================================
// canStart — базовые случаи
// ============================================================

test('canStart: пустой список задач → true (аккаунт свободен)', () => {
  assert.equal(canStart([], 'myacc', 'apply'), true);
});

test('canStart: аккаунт занят той же задачей → false', () => {
  const running = [{ account: 'myacc', task: 'apply' }];
  assert.equal(canStart(running, 'myacc', 'apply'), false);
});

test('canStart: аккаунт занят другой задачей → true (разные задачи на одном аккаунте разрешены, M12.5)', () => {
  const running = [{ account: 'myacc', task: 'messages' }];
  assert.equal(canStart(running, 'myacc', 'apply'), true);
});

test('canStart: другой аккаунт занят → true (наш свободен)', () => {
  const running = [{ account: 'otheracc', task: 'apply' }];
  assert.equal(canStart(running, 'myacc', 'apply'), true);
});

test('canStart: несколько задач, наш аккаунт не занят → true', () => {
  const running = [
    { account: 'acc1', task: 'apply' },
    { account: 'acc2', task: 'messages' },
  ];
  assert.equal(canStart(running, 'acc3', 'resume'), true);
});

test('canStart: несколько задач, наш аккаунт занят другой задачей → true (разные задачи разрешены, M12.5)', () => {
  const running = [
    { account: 'acc1', task: 'apply' },
    { account: 'acc2', task: 'messages' },
  ];
  assert.equal(canStart(running, 'acc2', 'resume'), true);
});

// ============================================================
// canStart — защитные случаи для account
// ============================================================

test('canStart: account пустой → false', () => {
  assert.equal(canStart([], '', 'apply'), false);
});

test('canStart: account только пробелы → false', () => {
  assert.equal(canStart([], '   ', 'apply'), false);
});

test('canStart: account=null → false', () => {
  assert.equal(canStart([], null, 'apply'), false);
});

test('canStart: account=undefined → false', () => {
  assert.equal(canStart([], undefined, 'apply'), false);
});

// ============================================================
// canStart — защитные случаи для task
// ============================================================

test('canStart: неизвестный task → false', () => {
  assert.equal(canStart([], 'myacc', 'wat'), false);
});

test('canStart: task=null → false', () => {
  assert.equal(canStart([], 'myacc', null), false);
});

test('canStart: task пустой → false', () => {
  assert.equal(canStart([], 'myacc', ''), false);
});

test('canStart: task алиас poll → нормализуется, возвращает true если свободен', () => {
  assert.equal(canStart([], 'myacc', 'poll'), true);
});

test('canStart: task алиас bump → нормализуется, возвращает true если свободен', () => {
  assert.equal(canStart([], 'myacc', 'bump'), true);
});

test('canStart: task алиас micro-edit → нормализуется, возвращает true', () => {
  assert.equal(canStart([], 'myacc', 'micro-edit'), true);
});

// ============================================================
// canStart — защитные случаи для runningTasks
// ============================================================

test('canStart: runningTasks не массив (null) → как пустой → true', () => {
  assert.equal(canStart(null, 'myacc', 'apply'), true);
});

test('canStart: runningTasks не массив (объект) → как пустой → true', () => {
  assert.equal(canStart({}, 'myacc', 'apply'), true);
});

test('canStart: runningTasks не массив (строка) → как пустой → true', () => {
  assert.equal(canStart('задачи', 'myacc', 'apply'), true);
});

test('canStart: runningTasks с некорректными записями → пропускаются', () => {
  const running = [null, undefined, 42, 'строка', {}, { task: 'apply' }];
  assert.equal(canStart(running, 'myacc', 'apply'), true, 'некорректные записи пропускаются');
});

test('canStart: runningTasks с некорректными и корректными записями — корректная та же пара → false', () => {
  // Запись с той же парой (myacc, apply) → false; malformed записи пропускаются.
  const running = [null, { task: 'apply' }, { account: 'myacc', task: 'apply' }];
  assert.equal(canStart(running, 'myacc', 'apply'), false);
});

test('canStart: совпадение account case-sensitive (myacc vs MyAcc → разные)', () => {
  const running = [{ account: 'MyAcc', task: 'apply' }];
  assert.equal(canStart(running, 'myacc', 'apply'), true, 'сравнение аккаунтов case-sensitive');
});

// ============================================================
// canStart — M12.5: пара (account, task)
// ============================================================

test('canStart: та же пара (account, task) → false', () => {
  const running = [{ account: 'myacc', task: 'apply' }];
  assert.equal(canStart(running, 'myacc', 'apply'), false);
});

test('canStart: тот же аккаунт, другая задача → true (M12.5)', () => {
  const running = [{ account: 'myacc', task: 'apply' }];
  assert.equal(canStart(running, 'myacc', 'messages'), true);
});

test('canStart: алиасное совпадение → false (running messages, want poll → оба нормализуются в messages)', () => {
  const running = [{ account: 'myacc', task: 'messages' }];
  assert.equal(canStart(running, 'myacc', 'poll'), false);
});
