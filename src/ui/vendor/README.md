# Vendored third-party assets

Локально захостенные ресурсы панели (Electron UI). Вендорятся, чтобы не тянуть
их с CDN во время работы — это требование CSP (`script-src 'self'`) и снимает
внешнюю сетевую зависимость/риск подмены.

## chart.umd.min.js

- **Библиотека:** Chart.js
- **Версия:** 4.5.1
- **Лицензия:** MIT
- **Источник:** https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js
- **SHA-256:** `48444A82D4EDCB5BEC0F1965FAACDDE18D9C17DB3063D042ABADA2F705C9F54A`

### Как обновлять

```powershell
$ver = '4.5.1'
Invoke-WebRequest "https://cdn.jsdelivr.net/npm/chart.js@$ver/dist/chart.umd.min.js" `
  -OutFile src\ui\vendor\chart.umd.min.js
(Get-FileHash src\ui\vendor\chart.umd.min.js -Algorithm SHA256).Hash
```

После обновления сверить SHA-256, обновить версию/хэш выше и прогнать `npm.cmd test`.
