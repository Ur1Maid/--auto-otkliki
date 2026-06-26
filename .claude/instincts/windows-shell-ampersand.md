---
name: windows-shell-ampersand
confidence: 0.85
created: 2026-06-24
tags: [windows, powershell, cli]
---

# Action
On Windows PowerShell/cmd, pass search via `--text DevOps --area 1`, not a full hh.ru search URL
containing `&`. Use `npm.cmd` / `npx.cmd` (not bare `npm`/`npx`) when invoking from tooling.

# Evidence
`&` is a shell metacharacter; a `--search "https://hh.ru/search/vacancy?text=...&area=1"` argument
gets truncated after the first `&`, silently dropping params. `parseArgs` already builds the URL
from `--text`/`--area` to sidestep this (review.js:180), and the README calls out the gotcha.

# Examples
```powershell
# Good
npm.cmd run review -- --account acc1 --text DevOps --area 1 --limit 200
# Risky on Windows — & may truncate
npm.cmd run review -- --search "https://hh.ru/search/vacancy?text=DevOps&area=1"
```
