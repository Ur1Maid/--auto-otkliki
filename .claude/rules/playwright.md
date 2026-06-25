# Playwright / hh.ru automation rules

Applies to `src/browser.js`, `src/login.js`, and all DOM/flow code in `src/review.js`.

## Selector strategy
- The hh.ru UI is **Russian and changes without notice**. Selectors are therefore **text- and
  role-based**, not brittle CSS/class hooks. Prefer, in order:
  1. `page.getByRole('button' | 'link' | 'radio', { name: /Откликнуться$/i })` with anchored,
     case-insensitive regexes (see `RESPONSE_BUTTON_TEXTS`, `APPLICATION_FLOW_BUTTON_TEXTS`).
  2. Visible-text pattern matching via `page.evaluate` over `document.querySelectorAll(...)` with
     an `isVisible` guard (the established pattern in `getChoiceGroups`, `getFieldContext`).
- When you add a new button/label, add it as a **regex to the existing array**, don't hardcode a
  one-off locator inline.

## Resilience is mandatory
- Every locator interaction assumes the node may be absent or detached:
  `await x.isVisible().catch(() => false)`, `.isEnabled().catch(() => true)`,
  `.isEditable().catch(() => false)` before acting.
- Clicks tolerate interception/timeout: reuse the `clickFirstVisibleByText` pattern that catches
  `intercepts pointer events` / `Timeout … exceeded` and tries the next candidate.
- Use the existing `dismissHarmlessPopups(page)` after navigations; add new harmless dialog labels
  to its list rather than writing new dismissal code.
- Keep `waitForTimeout` usage conservative and consistent with existing values; prefer event/state
  checks where practical, but match the current pragmatic style — don't over-engineer.

## State detection
- "Already applied" and "manual step required" are detected by **text patterns**
  (`APPLIED_PATTERNS`, `REQUIRED_MANUAL_PATTERNS`). If hh.ru wording changes, update these arrays —
  and verify against the actual page text, never guess the new phrasing.
- Mark inputs you've handled with the existing `data-deepseek-attempted` sentinel so re-scans skip them.

## Browser lifecycle
- `launchBrowser` runs **headful** (`headless: false`, `slowMo: 80`) by design (login + visibility).
  Don't flip to headless without a reason and approval.
- Sessions persist via `storageState` per account. Never log or commit `storage-state.json`.
- Always ensure the browser/context is closed on every exit path, including errors.

## Verifying selector changes (research-first)
- Before changing a selector, confirm the *current* DOM/text — read the page or have the user paste
  the relevant HTML/screenshot. Document the evidence in your report. A selector "that worked once"
  is not a justification; explain why it's resilient to the Russian-UI variants.
