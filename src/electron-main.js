// src/electron-main.js — Electron-обёртка вокруг локального дашборда (M15.1–M15.3).
//
// Что делает:
//   - запускает дочерний процесс `node src/dashboard.js --port <PORT>` (сервер не меняется);
//   - ждёт, пока порт 127.0.0.1:<PORT> начнёт принимать соединения;
//   - открывает BrowserWindow 1280×800 с http://127.0.0.1:<PORT>;
//   - создаёт Tray-иконку (M15.2): меню «Открыть панель», «Стоп всех задач», «Выйти»;
//   - закрытие окна сворачивает в трей, приложение живёт до «Выйти» или смерти сервера;
//   - «Запускать при старте» (M15.3): checkbox-пункт меню через app.setLoginItemSettings.
//
// Electron — только devDependency: production-поведение CLI (review/daemon/dashboard) не меняется.
// Сервер по-прежнему слушает ТОЛЬКО 127.0.0.1 — Electron лишь оборачивает его в окно.

import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';

import { nodeSpawnEnv } from './lib/spawnEnv.js';

const here = dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1';
const PORT = Number(process.env.DASHBOARD_PORT) || 8787;
const PANEL_URL = `http://${HOST}:${PORT}`;

let serverProc = null;
let mainWindow = null;
let tray = null;

// true только при реальном выходе (через «Выйти» в меню трея), чтобы отличить
// закрытие окна (→ скрыть в трей) от настоящего завершения приложения.
let isQuitting = false;

/** Спавнит дочерний сервер дашборда тем же Node, что и Electron-main. */
function startServer() {
  const dashboard = join(here, 'dashboard.js');
  const proc = spawn(process.execPath, [dashboard, '--port', String(PORT)], {
    stdio: 'inherit',
    env: nodeSpawnEnv(),
  });
  proc.on('exit', () => {
    // Сервер умер — нет смысла держать окно на мёртвом порту.
    // isQuitting=true, иначе close-хендлер окна перехватит quit и свернёт в трей.
    serverProc = null;
    isQuitting = true;
    app.quit();
  });
  proc.on('error', (err) => {
    console.error(`[electron] не удалось запустить сервер: ${err.message}`);
    serverProc = null;
    isQuitting = true;
    app.quit();
  });
  return proc;
}

/** Ждёт, пока host:port начнёт принимать TCP-соединения (сервер поднялся). */
function waitForPort(host, port, { timeoutMs = 15000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = createConnection({ host, port });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`порт ${host}:${port} не открылся за ${timeoutMs} мс`));
        } else {
          setTimeout(tryOnce, intervalMs);
        }
      });
    };
    tryOnce();
  });
}

/** Создаёт главное окно и загружает в него локальную панель. */
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'hh-auto-otkliki — панель',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await mainWindow.loadURL(PANEL_URL);
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

/** Завершает дочерний сервер, если он ещё жив. */
function stopServer() {
  if (serverProc && !serverProc.killed) {
    serverProc.kill();
  }
  serverProc = null;
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
 * Останавливает все запущенные задачи: получает список аккаунтов через
 * GET /api/accounts, затем шлёт POST /api/stop по каждому.
 * Запросы идут из Electron main process (Node), без браузерного Origin.
 * Выставляем Origin вручную, чтобы isLoopbackRequest в dashboard.js пропустил.
 * Лучший вариант: оборачиваем в try/catch, никогда не бросаем наружу.
 */
async function stopAllTasks() {
  const loopbackOrigin = `http://${HOST}:${PORT}`;
  const headers = {
    'Content-Type': 'application/json',
    'Origin': loopbackOrigin,
  };
  try {
    const resp = await fetch(`${PANEL_URL}/api/accounts`, { headers });
    if (!resp.ok) {
      console.error(`[electron] /api/accounts вернул ${resp.status}`);
      return;
    }
    const { accounts } = await resp.json();
    if (!Array.isArray(accounts) || accounts.length === 0) {
      console.log('[electron] нет аккаунтов для остановки');
      return;
    }
    for (const account of accounts) {
      try {
        const stopResp = await fetch(`${PANEL_URL}/api/stop`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ account }),
        });
        console.log(`[electron] стоп ${account}: ${stopResp.status}`);
      } catch (err) {
        console.error(`[electron] ошибка стопа ${account}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[electron] ошибка получения аккаунтов: ${err.message}`);
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

app.whenReady().then(async () => {
  serverProc = startServer();
  try {
    await waitForPort(HOST, PORT);
    createTray();
    await createWindow();
  } catch (err) {
    console.error(`[electron] не удалось открыть панель: ${err.message}`);
    stopServer();
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
  stopServer();
});
