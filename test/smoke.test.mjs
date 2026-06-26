import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Smoke-тест: каждый файл src/*.js должен парситься без ошибок.
// ВАЖНО: используем `node --check` (только парсинг), а НЕ import — src/review.js и src/check.js
// исполняются при импорте (запускают браузер / process.exit) и не должны выполняться в тестах.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const files = readdirSync(srcDir).filter((name) => name.endsWith('.js'));

test('в src/ есть основные точки входа', () => {
  for (const expected of ['login.js', 'review.js', 'check.js']) {
    assert.ok(files.includes(expected), `отсутствует src/${expected}`);
  }
});

for (const file of files) {
  test(`src/${file} парсится (node --check)`, () => {
    execFileSync(process.execPath, ['--check', path.join(srcDir, file)], { stdio: 'pipe' });
  });
}
