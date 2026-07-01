// ESLint flat config — минимальный, под ESM/Node 20 стиль этого репо.
// Линтит src/** и test/**. Браузерный код панели теперь живёт отдельным файлом
// src/ui/app.js (грузится в рендерер Electron) — под него отдельный блок с
// браузерными глобалами ниже. Запуск: npm run lint.

import js from '@eslint/js';

export default [
  {
    ignores: ['node_modules/**', '.claude/**', 'ralph/logs/**', 'logs/**', 'data/**', '.hh-session/**', 'src/ui/vendor/**'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'test/**/*.mjs', '*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Node-окружение (без отдельного пакета globals — перечисляем явно используемое).
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        structuredClone: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        globalThis: 'readonly',
        // Браузерный контекст: код внутри page.evaluate(() => …) исполняется в браузере
        // hh.ru, а не в Node. Эти глобалы там легитимны (Playwright сериализует колбэк).
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        getComputedStyle: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        CSS: 'readonly',
      },
    },
    rules: {
      // Стиль репо: .catch(() => fallback) и catch {} — не требуем биндинг ошибки.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Неразрывные пробелы (nbsp) намеренно живут в регэкспах разбора hh.ru-плашек
      // (страница отдаёт &nbsp;) и в поясняющих их комментариях — урок M11.6. Строки уже
      // пропускаются по умолчанию; разрешаем nbsp также в комментариях и регэкспах.
      'no-irregular-whitespace': ['error', { skipComments: true, skipRegExps: true, skipStrings: true }],
      // Репо намеренно использует защитную инициализацию (let x = []; потом try/catch
      // перезапишет). Не считаем это ошибкой — иначе провоцируем рискованные «починки».
      'no-useless-assignment': 'off',
    },
  },
  {
    // Рендерер Electron-панели (src/ui/app.js): классический браузерный скрипт, грузится
    // в BrowserWindow через <script src>. Глобалы — браузерные (window.api из preload,
    // Chart из CDN, DOM/таймеры), sourceType 'script' (нет import/export).
    files: ['src/ui/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        alert: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Chart: 'readonly',
      },
    },
  },
];
