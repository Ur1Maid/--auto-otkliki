// src/electron-main.js — Electron-обёртка панели hh-auto-otkliki: единственный UI (M20).
//
// Что делает:
//   - НЕ поднимает HTTP-сервер и не открывает порт: рендерер грузит локальный
//     src/ui/index.html через loadFile, а данные/команды идут по IPC (contextIsolation +
//     preload-мост src/preload.cjs, canal 'dash:*').
//   - Собирает метрики/живой снимок напрямую в main-процессе (lib/dashboardData.js) и
//     выполняет команды старт/стоп/логин через lib/dashboardActions.js поверх общего
//     lib/taskRunner.js (тот же реестр задач, что был у HTTP-панели).
//   - Периодически (раз в ~400 мс) проверяет mtime файлов статуса/ресурсов и при изменении
//     пушит свежий снимок «Сейчас» в рендерер (замена SSE-стрима dashboard.js).
//   - Создаёт Tray-иконку: меню «Открыть панель», «Стоп всех задач», «Запускать при старте», «Выйти».
//   - Закрытие окна сворачивает в трей, приложение живёт до «Выйти».
//
// Electron — только devDependency: production-поведение CLI (review/daemon) не меняется.
// Нет открытого порта — управление доступно только из этого приложения.

import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createTaskRunner } from './lib/taskRunner.js';
import { collectMetrics, collectLive, collectStreamMtimes, listAccounts } from './lib/dashboardData.js';
import {
  handleStart,
  handleStop,
  handleLoginDone,
  handleTasks,
  handleAccounts,
  defaultWriteLoginDone,
} from './lib/dashboardActions.js';
import { buildMtimeSignature, signatureChanged } from './lib/streamWatcher.js';

const here = dirname(fileURLToPath(import.meta.url));

// Период опроса mtime файлов статуса/ресурсов для живого пуша «Сейчас» (было SSE, M13.3).
const STREAM_POLL_MS = 400;

// Свой реестр задач: одна задача данного типа на аккаунт, трекинг PID (M11.8).
// Аудит-лог запусков/остановок (M11.9) — только task/account/live/pid, без ключа/PII.
const runner = createTaskRunner({ log: (msg) => console.log(msg) });

let mainWindow = null;
let tray = null;
let livePushTimer = null;

// true только при реальном выходе (через «Выйти» в меню трея), чтобы отличить
// закрытие окна (→ скрыть в трей) от настоящего завершения приложения.
let isQuitting = false;

/** Создаёт главное окно и загружает в него локальный HTML панели (без сети). */
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'hh-auto-otkliki — панель',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(here, 'preload.cjs'),
    },
  });
  // Защита привилегированного окна (defense-in-depth, security-review): панель — локальный
  // UI, ей незачем куда-либо навигировать или открывать новые окна. Блокируем и то и другое,
  // чтобы внедрённый/CDN-скрипт не увёл окно на внешний origin.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  await mainWindow.loadFile(join(here, 'ui', 'index.html'));
  // Закрытие окна → скрыть в трей (не завершать приложение).
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Генерирует минимальную 16×16 tray-иконку из base64 PNG-данных.
 * Однотонный синий квадрат — никаких внешних файлов в репозитории.
 */
function buildTrayIcon() {
  // Минимальный валидный 16×16 PNG: однотонный синий квадрат (RGBA #3a7bd5).
  // Сгенерирован как raw PNG-байты (IHDR + IDAT + IEND).
  const TRAY_ICON_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHklEQVQ4y2NgGAWk' +
    'AH////9nIEMzqIFhYAABAAD//wMABQAB/1U/pQAAAABJRU5ErkJggg==';
  return nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_B64}`);
}

/**
 * Останавливает все запущенные задачи: берёт список аккаунтов напрямую (listAccounts)
 * и стопит каждый через runner.stop — без HTTP, без fetch. Best-effort: одна упавшая
 * остановка не мешает остальным, наружу никогда не бросает.
 */
async function stopAllTasks() {
  let accounts = [];
  try {
    accounts = await listAccounts();
  } catch (err) {
    console.error(`[electron] ошибка получения аккаунтов: ${err.message}`);
    return;
  }
  if (!Array.isArray(accounts) || accounts.length === 0) {
    console.log('[electron] нет аккаунтов для остановки');
    return;
  }
  for (const account of accounts) {
    try {
      const result = runner.stop({ account });
      console.log(`[electron] стоп ${account}: ${result && result.status}`);
    } catch (err) {
      console.error(`[electron] ошибка стопа ${account}: ${err.message}`);
    }
  }
}

/** Показывает/восстанавливает главное окно (или пересоздаёт, если было закрыто). */
async function showWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    // Окно было закрыто полностью — создаём заново.
    await createWindow().catch((err) => {
      console.error(`[electron] не удалось открыть панель: ${err.message}`);
    });
  }
}

/**
 * Строит контекстное меню трея.
 * Вызывается при инициализации и при переключении «Запускать при старте»,
 * чтобы checkbox всегда отражал актуальное состояние.
 */
function buildTrayMenu() {
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    {
      label: 'Открыть панель',
      click: () => {
        showWindow().catch(() => {});
      },
    },
    {
      label: 'Стоп всех задач',
      click: () => {
        stopAllTasks().catch(() => {});
      },
    },
    { type: 'separator' },
    {
      label: 'Запускать при старте',
      type: 'checkbox',
      checked: openAtLogin,
      click: (menuItem) => {
        const newValue = menuItem.checked;
        app.setLoginItemSettings({ openAtLogin: newValue });
        // Перестраиваем меню, чтобы checkbox отразил новое состояние.
        tray.setContextMenu(buildTrayMenu());
      },
    },
    { type: 'separator' },
    {
      label: 'Выйти',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

/** Создаёт Tray-иконку с меню. */
function createTray() {
  const icon = buildTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('hh-auto-otkliki');
  tray.setContextMenu(buildTrayMenu());
  // Двойной клик по иконке — показать окно.
  tray.on('double-click', () => {
    showWindow().catch(() => {});
  });
}

/** Регистрирует IPC-обработчики 'dash:*' — единственный канал рендерера к данным/командам. */
function registerIpc() {
  ipcMain.handle('dash:metrics', () => collectMetrics());
  ipcMain.handle('dash:live', () => collectLive());
  ipcMain.handle('dash:accounts', async () => (await handleAccounts(listAccounts)).body);
  ipcMain.handle('dash:tasks', () => handleTasks(runner).body);
  ipcMain.handle('dash:start', (_e, payload) => handleStart(runner, payload || {}).body);
  ipcMain.handle('dash:stop', (_e, payload) => handleStop(runner, payload || {}).body);
  ipcMain.handle('dash:login-done', async (_e, payload) => (await handleLoginDone(defaultWriteLoginDone, payload || {})).body);
}

/**
 * Живой пуш блока «Сейчас» (было SSE в dashboard.js, M13.3): раз в ~400 мс сверяем mtime
 * статус/ресурс-файлов и при изменении отправляем свежий снимок в рендерер через
 * webContents.send. Best-effort — сбой чтения не роняет таймер (следующий тик повторит).
 */
function startLivePush() {
  let busy = false;
  let lastSig = null;

  const tick = async (force) => {
    if (busy) return; // не наслаиваем тики, если чтение/collectLive затянулось
    busy = true;
    try {
      const sig = buildMtimeSignature(await collectStreamMtimes());
      if (force || signatureChanged(lastSig, sig)) {
        lastSig = sig;
        const data = await collectLive();
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('dash:live-update', data);
        }
      }
    } catch {
      // best-effort — сбой чтения не роняет пуш (следующий тик повторит)
    } finally {
      busy = false;
    }
  };

  tick(true);
  livePushTimer = setInterval(() => tick(false), STREAM_POLL_MS);
  if (typeof livePushTimer.unref === 'function') livePushTimer.unref(); // не держим event loop
}

app.whenReady().then(async () => {
  try {
    registerIpc();
    createTray();
    await createWindow();
    startLivePush();
  } catch (err) {
    console.error(`[electron] не удалось открыть панель: ${err.message}`);
    isQuitting = true;
    app.quit();
  }
});

// На Windows закрытие последнего окна не должно завершать приложение —
// оно продолжает жить в трее. Поэтому window-all-closed НЕ вызывает app.quit().
app.on('window-all-closed', () => {
  // Намеренно ничего не делаем: приложение живёт в трее до «Выйти».
});

app.on('before-quit', () => {
  if (livePushTimer) clearInterval(livePushTimer);
});
