// Безопасная IO-обёртка ЗАПИСИ реального resume.md (M6.3).
// ВСЕГДА создаёт бэкап ДО перезаписи; dryRun === true по умолчанию.
// Пишет только явно одобренные additive-навыки (honesty invariant).
//
// Зависимости: tailorResume, backupFileName (src/lib/resumeTailor.js),
//              node:path, node:fs/promises. Внешние deps инъектируются для тестов.

import { tailorResume, backupFileName } from './resumeTailor.js';
import path from 'node:path';
import { readFile as realReadFile, writeFile as realWriteFile } from 'node:fs/promises';

/**
 * Применяет одобренные additive-навыки к файлу резюме с полной защитой записи.
 *
 * По умолчанию — dry-run (dryRun === true): файл НЕ меняется, возвращается
 * preview для показа оператору. Реальная запись только при явном dryRun: false.
 *
 * Порядок операций:
 *   1. Валидация resumePath.
 *   2. Чтение исходного файла.
 *   3. Применение tailorResume (additive-only, honesty guardrail).
 *   4. Проверка applied и наличия реальных изменений.
 *   5. Dry-run: возврат preview без записи.
 *   6. Реальная запись: сначала бэкап, затем новый файл.
 *
 * @param {{
 *   resumePath: string,
 *   approvedSkills?: string[],
 *   limits?: { maxChangedLines?: number, minSimilarity?: number, maxNewSkills?: number },
 *   dryRun?: boolean,
 *   date?: Date,
 * }} params
 * @param {{
 *   readFile?: Function,
 *   writeFile?: Function,
 * }} [deps] - Инъекция зависимостей для тестов; дефолт — реальные node:fs/promises.
 * @returns {Promise<object>} Результат операции.
 */
export async function writeTailoredResume(params, deps = {}) {
  const {
    resumePath,
    approvedSkills,
    limits,
    dryRun = true,
    date,
  } = (params !== null && typeof params === 'object') ? params : {};

  const readFile = deps.readFile ?? realReadFile;
  const writeFile = deps.writeFile ?? realWriteFile;

  // 1. Валидация пути
  if (typeof resumePath !== 'string' || resumePath.trim() === '') {
    return { written: false, reason: 'invalid_path' };
  }

  // 2. Чтение исходного файла
  let original;
  try {
    original = await readFile(resumePath, 'utf8');
  } catch {
    return { written: false, reason: 'read_failed' };
  }

  // 3. Применение tailorResume (additive-only, honesty)
  const result = tailorResume(original, { approvedSkills, limits });

  // 4a. Проверка applied
  if (result.applied !== true) {
    return {
      written: false,
      reason: result.reason ?? 'not_applied',
      divergence: result.divergence,
      addedSkills: [],
    };
  }

  // 4b. Проверка наличия реальных изменений
  if (result.tailored === original) {
    return { written: false, reason: 'no_changes', addedSkills: [] };
  }

  // 5. Dry-run (дефолт) — не пишем файл, возвращаем preview
  if (dryRun !== false) {
    return {
      written: false,
      reason: 'dry_run',
      wouldAddSkills: result.addedSkills,
      divergence: result.divergence,
      preview: result.tailored,
    };
  }

  // 6. Реальная запись (dryRun явно false)

  // 6a. Имя и путь бэкапа.
  // Нормализуем date: невалидный/отсутствующий → new Date() (backupFileName бросает
  // TypeError на Invalid Date — не даём этому пробросу выйти наружу, контракт «не бросать»).
  const safeDate = (date instanceof Date && !isNaN(date.getTime())) ? date : new Date();
  const dir = path.dirname(resumePath);
  const base = path.basename(resumePath);
  const backupPath = path.join(dir, backupFileName(base, safeDate));

  // 6b. Бэкап ДО перезаписи — если не удался, resume.md НЕ трогаем
  try {
    await writeFile(backupPath, original, 'utf8');
  } catch {
    return { written: false, reason: 'backup_failed' };
  }

  // 6c. Запись нового резюме
  try {
    await writeFile(resumePath, result.tailored, 'utf8');
  } catch {
    // Бэкап уже создан — оператор может откатить вручную
    return { written: false, reason: 'write_failed', backupPath };
  }

  // 6d. Успех
  return {
    written: true,
    backupPath,
    addedSkills: result.addedSkills,
    divergence: result.divergence,
  };
}
