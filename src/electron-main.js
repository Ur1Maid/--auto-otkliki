// src/electron-main.js — Electron-обёртка вокруг локального дашборда (M15.1).
//
// Что делает:
//   - запускает дочерний процесс `node src/dashboard.js --port <PORT>` (сервер не меняется);
//   - ждёт, пока порт 127.0.0.1:<PORT> начнёт принимать соединения;
//   - открывает BrowserWindow 1280×800 с http://127.0.0.1:<PORT>;
//   - при закрытии окна / выходе — завершает дочерний процесс сервера.
//
// Electron — только devDependency: production-поведение CLI (review/daemon/dashboard) не меняется.
// Сервер по-прежнему слушает ТОЛЬКО 127.0.0.1 — Electron лишь оборачивает его в окно.

import { app, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1';
const PORT = Number(process.env.DASHBOARD_PORT) || 8787;
const PANEL_URL = `http://${HOST}:${PORT}`;

let serverProc = null;
let mainWindow = null;

/** Спавнит дочерний сервер дашборда тем же Node, что и Electron-main. */
function startServer() {
  const dashboard = join(here, 'dashboard.js');
  const proc = spawn(process.execPath, [dashboard, '--port', String(PORT)], {
    stdio: 'inherit',
    env: process.env,
  });
  proc.on('exit', () => {
    // Сервер умер — нет смысла держать окно на мёртвом порту.
    serverProc = null;
    app.quit();
  });
  proc.on('error', (err) => {
    console.error(`[electron] не удалось запустить сервер: ${err.message}`);
    serverProc = null;
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

app.whenReady().then(async () => {
  serverProc = startServer();
  try {
    await waitForPort(HOST, PORT);
    await createWindow();
  } catch (err) {
    console.error(`[electron] не удалось открыть панель: ${err.message}`);
    stopServer();
    app.quit();
  }
});

// Закрытие окна → завершаем сервер и приложение (M15.2 заменит это сворачиванием в трей).
app.on('window-all-closed', () => {
  stopServer();
  app.quit();
});

app.on('before-quit', () => {
  stopServer();
});
