// src/lib/confirmPolicy.js — TTY-aware политика подтверждений (M16.2).
//
// ПРОБЛЕМА: confirm()/ask() читают stdin через readline. Когда review.js/daemon.js
// запущены из панели/демона/Electron, интерактивного stdin нет (isTTY=false) → чтение
// блокируется навсегда, и реальное действие (отклик/отправка) не доходит до конца.
//
// resolveConfirmPolicy — чистый выбор поведения по наличию TTY и авто-флага оператора:
//   - autoFlag (оператор уже подтвердил Live)         → 'auto'    (не спрашивать, делать)
//   - есть TTY, нет autoFlag                          → 'prompt'  (спросить в терминале)
//   - нет TTY и нет autoFlag                          → 'decline' (безопасный отказ, не виснуть)
//
// Безопасность: дефолт без TTY и без явного авто-флага — ОТКАЗ, чтобы запуск из GUI/демона
// никогда не зависал и не совершал исходящее действие без явного opt-in.

/**
 * @param {{ isTTY?: boolean, autoFlag?: boolean }} [opts]
 * @returns {'auto' | 'prompt' | 'decline'}
 */
export function resolveConfirmPolicy({ isTTY, autoFlag } = {}) {
  if (autoFlag) return 'auto';
  if (isTTY) return 'prompt';
  return 'decline';
}
