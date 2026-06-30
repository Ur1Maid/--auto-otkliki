// src/lib/spawnEnv.js — окружение для внутренних spawn(process.execPath, …) (M16.1).
//
// ПРОБЛЕМА: внутренние дочерние процессы спавнятся через process.execPath. Когда цепочка
// стартует из Electron, process.execPath = electron.exe — и без флага ELECTRON_RUN_AS_NODE
// дочерний процесс исполняется как Electron-app, а не как Node → review.js/daemon.js виснут
// (Playwright/навигация не работают в Electron-режиме). Под обычным `node` переменная
// игнорируется — безопасный no-op.
//
// nodeSpawnEnv возвращает КОПИЮ env с выставленным флагом, НИКОГДА не мутируя вход
// (источник обычно process.env — мутация была бы глобальным сайд-эффектом). Никаких логов:
// env может содержать секреты (DEEPSEEK_API_KEY), модуль их только копирует, не печатает.

/**
 * Возвращает копию окружения с ELECTRON_RUN_AS_NODE='1', чтобы дочерний процесс,
 * запущенный через process.execPath, всегда исполнялся как Node (даже если execPath —
 * electron.exe). Под обычным Node флаг игнорируется.
 *
 * @param {Record<string, string|undefined>} [baseEnv=process.env] — базовое окружение.
 *   Не-объект (null/строка/число) трактуется как пустое окружение.
 * @returns {Record<string, string>} новый объект env (вход не мутируется).
 */
export function nodeSpawnEnv(baseEnv = process.env) {
  const source = baseEnv && typeof baseEnv === 'object' ? baseEnv : {};
  return { ...source, ELECTRON_RUN_AS_NODE: '1' };
}
