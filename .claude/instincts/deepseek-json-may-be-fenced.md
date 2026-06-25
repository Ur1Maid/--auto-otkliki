---
name: deepseek-json-may-be-fenced
confidence: 0.95
created: 2026-06-24
tags: [deepseek, parsing, json]
---

# Action
Never `JSON.parse` DeepSeek output directly. Always go through `parseJsonObject` (review.js:554),
which strips ```json fences and extracts the first `{…}` block, wrapped in `try/catch` with a safe
default. Then clamp/normalize every field (e.g. `score` → 0–100).

# Evidence
DeepSeek (deepseek-chat) frequently wraps JSON in markdown fences or adds a leading sentence despite
"answer only JSON" instructions. Raw parsing throws and silently zeroes a vacancy's score or empties
a form. The codebase already standardized on `parseJsonObject` for exactly this reason
(`scoreVacancyWithDeepSeek`, `askDeepSeekChoice`, `askDeepSeekForm`).

# Examples
```js
let parsed = { score: 0, reason: 'parse_failed' };
try { parsed = parseJsonObject(result.content); } catch {}
const score = Number(parsed.score);
const normalized = { score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0, ... };
```
