---
name: verify-live-flow
description: >-
  Safe procedure to verify the live hh.ru flow (applies, messages, resume edit) end-to-end against a
  real account. Use before trusting a Playwright/flow change in production, or when asked to "do a
  real run". Enforces dry-run-first, single-account, small-limit gating so a bug can't fan out into
  hundreds of real applications.
---

# Verify the live hh.ru flow

Adapted from ECC's `verification-loop` and `e2e-testing`, scoped to this repo's reality: there is no
headless Playwright test suite — the browser flow is verified by **gated live runs** plus the offline
unit tests. Live actions are irreversible (real applications, real chat messages), so verification is
staged from safest to riskiest.

## Pre-flight (always, offline)
1. `node --check` on edited `src/*.js`; `node --test` green (state counts).
2. `node src/check.js` — confirms Playwright, saved session, `DEEPSEEK_API_KEY` (from `.env`),
   resume/salary present. Never print the key.
3. `research-first` if a selector/DOM/prompt changed — confirm the live DOM (a throwaway read-only
   Playwright script that dumps `data-qa` is fine; delete it after).

## Staged live verification
Run one account, small limit, and watch each stage:

1. **Dry-run preview first.** The daemon defaults to dry-run; `review.js` honors `--manual`.
   - `node src/daemon.js --task messages --account <acc>` (no `--live`) → reads, sends nothing.
   - `node src/daemon.js --task resume --account <acc>` (no `--live`) → previews the edit, no save.
   - `node src/daemon.js --task apply --account <acc> --text <q> --area <id> --limit 5` → dry-run.
2. **Then go live, one safe step at a time** (each opens a headful browser — operator present):
   - Resume edit (reversible): `--task resume --account <acc> --live` → reports `change` +
     `beforeTail`→`afterTail`. Confirm `changed=true, reason=saved`.
   - Applies (small): `--task apply --account <acc> --text <q> --area <id> --limit 5 --live`.
     `--limit` = number of SUCCESSFUL applies (stops after N), not pool size.
   - Messages: `--task messages --account <acc> --live --reply-auto`. Only UNREAD threads are
     answered by design. Report `replied / skipped / manual`.

## Honest reporting (non-negotiable)
- Report actual outcomes: applies sent, replies sent, what changed in the resume. If 0 unread →
  0 replies; say so, don't manufacture a send.
- Closed/rejection chat threads have no composer → `composer_not_editable` is correct, not a bug
  (see instinct `hh-closed-thread-no-composer`).
- Area codes: `1`=Москва, `113`=Россия (used by `review.js` search URL).

## Cleanup & safety
- Delete any throwaway inspection scripts. Keep `logs/realrun-*.log` (git-ignored) for evidence.
- Never run an auto-submitting flow at high `--limit` against a real account just to "test".
- 200-application / 08:00 production cadence runs via the external scheduler (`scripts/scheduler/`),
  not by hand.
