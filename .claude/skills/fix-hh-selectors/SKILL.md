---
name: fix-hh-selectors
description: >-
  Repair Playwright automation after an hh.ru UI change — the response button isn't found, the
  form isn't filled, "already applied" / "manual step" is misdetected, or popups block the flow.
  Use when the scraping/apply flow breaks against the live site.
---

# Fix hh.ru selectors

hh.ru ships UI/wording changes without notice. Because the locators here are text/role-based and
Russian-language, a relabel or restructure silently breaks the flow. Fix with evidence, not guesses.

## 1. Get ground truth first (research-first)
You cannot fix a selector you can't see. Obtain the *current* page:
- Ask the user to paste the relevant HTML snippet or a screenshot of the broken step, **or**
- Run headful and read the page (`launchBrowser` is already `headless: false`).
Note the exact Russian label, the element role (button/link/radio), and surrounding structure.

## 2. Find the relevant code (`src/review.js`)
- Response button → `RESPONSE_BUTTON_TEXTS`, `findResponseButton` (review.js:29, :340).
- Apply-flow buttons → `APPLICATION_FLOW_BUTTON_TEXTS`, `clickFirstVisibleByText` (review.js:34, :1031).
- "Applied" detection → `APPLIED_PATTERNS` / `pageLooksApplied` (review.js:46, :1026).
- "Manual step required" → `REQUIRED_MANUAL_PATTERNS` / `pageHasRequiredManualStep` (review.js:20, :1021).
- Field/question context → `getFieldContext`, `getChoiceGroups` (review.js:1122, :1225).
- Resume picker / cover-letter open → `selectFirstResumeOption`, `openCoverLetterEditor`.
- Harmless popups → `dismissHarmlessPopups` (browser.js:25).

## 3. Make the minimal, resilient change
- Prefer **adding a regex variant** to the relevant array over inventing a new inline locator.
  Anchor it (`/^Откликнуться$/i`) to avoid over-matching.
- Keep the `.catch(() => …)` / visibility / enabled guards. Never assume a node exists.
- For new harmless dialogs, add the label to `dismissHarmlessPopups`' list.
- For new state wording, add the phrase to `APPLIED_PATTERNS` / `REQUIRED_MANUAL_PATTERNS` — copied
  from the real page text, not paraphrased.

## 4. Verify safely
- Re-run in **manual** mode so nothing submits unexpectedly:
  ```powershell
  npm.cmd run review:manual -- --account <name> --text DevOps --area 1 --limit 5
  ```
- Confirm the previously-broken step now works and you didn't regress popup dismissal or
  applied/manual detection.

## Guardrails
- Don't switch to brittle CSS/class selectors — hh.ru classes are unstable.
- Don't disable `--manual`-style safety to make testing faster.
- Record the breakage + fix as an instinct (see `capture-instinct`) so the next UI change is faster.
