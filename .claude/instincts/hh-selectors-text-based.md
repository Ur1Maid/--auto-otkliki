---
name: hh-selectors-text-based
confidence: 0.9
created: 2026-06-24
tags: [playwright, hh-ru, selectors, resilience]
---

# Action
Locate hh.ru elements by **role + Russian visible text** (anchored, case-insensitive regex), not by
CSS class. Add new labels as regex entries to the existing arrays (`RESPONSE_BUTTON_TEXTS`,
`APPLICATION_FLOW_BUTTON_TEXTS`, `APPLIED_PATTERNS`, `REQUIRED_MANUAL_PATTERNS`) and keep every
interaction guarded with `.catch(() => false)` + visibility/enabled checks.

# Evidence
hh.ru changes markup/wording without notice and its CSS classes are unstable/hashed. The whole flow
in `src/review.js` is built on text/role matching and `page.evaluate` visibility scans precisely
because class-based selectors break constantly. State (applied / manual-required) is detected purely
by text patterns.

# Examples
```js
const RESPONSE_BUTTON_TEXTS = [/^Откликнуться$/i, /^Откликнуться на вакансию$/i];
const button = page.getByRole('button', { name: text }).first();
if (await button.isVisible().catch(() => false)) return button;
```
When a step breaks: get the real current label from the live page, add a regex variant — don't write
a one-off CSS locator.
