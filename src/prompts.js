import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { resolveConfirmPolicy } from './lib/confirmPolicy.js';

export function createPrompt() {
  return readline.createInterface({ input, output });
}

export async function ask(prompt, defaultValue = '') {
  // Без интерактивного stdin (панель/демон/Electron) чтение зависло бы навсегда —
  // возвращаем дефолт вместо блокировки.
  if (resolveConfirmPolicy({ isTTY: Boolean(input.isTTY) }) === 'decline') return defaultValue;
  const rl = createPrompt();
  try {
    const answer = (await rl.question(prompt)).trim();
    return answer || defaultValue;
  } finally {
    rl.close();
  }
}

export async function confirm(prompt) {
  // Нет TTY → безопасный отказ, не виснем на stdin (исходящее действие требует явного opt-in).
  if (resolveConfirmPolicy({ isTTY: Boolean(input.isTTY) }) !== 'prompt') return false;
  const answer = (await ask(`${prompt} [y/N] `)).toLowerCase();
  return answer === 'y' || answer === 'yes' || answer === 'д' || answer === 'да';
}
