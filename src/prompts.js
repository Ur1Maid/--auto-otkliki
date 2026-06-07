import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export function createPrompt() {
  return readline.createInterface({ input, output });
}

export async function ask(prompt, defaultValue = '') {
  const rl = createPrompt();
  try {
    const answer = (await rl.question(prompt)).trim();
    return answer || defaultValue;
  } finally {
    rl.close();
  }
}

export async function confirm(prompt) {
  const answer = (await ask(`${prompt} [y/N] `)).toLowerCase();
  return answer === 'y' || answer === 'yes' || answer === 'д' || answer === 'да';
}
