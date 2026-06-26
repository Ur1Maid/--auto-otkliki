// ESLint flat config — минимальный, под ESM/Node 20 стиль этого репо.
// Линтит src/** и test/**. Браузерный код внутри dashboard.js лежит строкой-шаблоном
// (PAGE) и как код не линтится. Запуск: npm run lint.

import js from '@eslint/js';

export default [
  {
    ignores: ['node_modules/**', '.claude/**', 'ralph/logs/**', 'logs/**', 'data/**', '.hh-session/**'],
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
      // Репо намеренно использует защитную инициализацию (let x = []; потом try/catch
      // перезапишет). Не считаем это ошибкой — иначе провоцируем рискованные «починки».
      'no-useless-assignment': 'off',
    },
  },
];
