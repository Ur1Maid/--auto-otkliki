import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sessionDir = path.join(rootDir, '.hh-session');
export const storageStatePath = path.join(sessionDir, 'storage-state.json');
export const dataDir = path.join(rootDir, 'data');
export const inputDir = path.join(rootDir, 'input');
export const logsDir = path.join(rootDir, 'logs');
export const configDir = path.join(rootDir, 'config');
export const accountsConfigDir = path.join(configDir, 'accounts');
export const logPath = path.join(logsDir, 'responses-log.jsonl');

export function normalizeAccountName(account = 'default') {
  return String(account || 'default')
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'default';
}

export function getAccountSessionDir(account = 'default') {
  const normalized = normalizeAccountName(account);
  return normalized === 'default'
    ? sessionDir
    : path.join(sessionDir, 'accounts', normalized);
}

export function getAccountStorageStatePath(account = 'default') {
  return path.join(getAccountSessionDir(account), 'storage-state.json');
}

export function getAccountLogPath(account = 'default') {
  const normalized = normalizeAccountName(account);
  return normalized === 'default'
    ? logPath
    : path.join(logsDir, `responses-${normalized}.jsonl`);
}

export function getAccountConfigDir(account = 'default') {
  return path.join(accountsConfigDir, normalizeAccountName(account));
}

export function getAccountResumePath(account = 'default') {
  return path.join(getAccountConfigDir(account), 'resume.md');
}

export function getAccountSalaryPath(account = 'default') {
  return path.join(getAccountConfigDir(account), 'salary.md');
}

export function getAccountSummaryPath(account = 'default') {
  const normalized = normalizeAccountName(account);
  return normalized === 'default'
    ? path.join(logsDir, 'summary.json')
    : path.join(logsDir, `summary-${normalized}.json`);
}

export async function ensureAppDirs() {
  await mkdir(sessionDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(inputDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  await mkdir(configDir, { recursive: true });
  await mkdir(accountsConfigDir, { recursive: true });
}
