# Testing & quality rules

Adapted from ECC's `node.md` (test/lint/coverage discipline), tuned to this repo's minimal
ESM + `node --test` setup. Applies to everything under `src/` and `test/`.

## Test runner
- Tests run via `node --test` (the `npm test` script). No Jest/Vitest/Mocha — don't add one.
- Test files live in `test/`, named `<module>.test.mjs`, and import from `src/lib/**`.
- `src/review.js`, `src/check.js`, `src/login.js`, `src/daemon.js` execute on import (browser /
  `process.exit`) — **never** `import` them in a test. Cover only the pure modules they delegate to.
  `test/smoke.test.mjs` already guards parse-safety of every `src/*.js` via `node --check`.

## What every change must keep green
- `node --check <file>` on each edited `src/*.js` (parse safety).
- `node --test` (full suite) — must stay at 0 fail. State the pass/fail counts honestly.
- If you change a pure helper, add/extend its `test/*.test.mjs` in the same diff.

## Coverage of new logic
- New `src/lib/*` module → matching `test/<name>.test.mjs` with: happy path, guard cases
  (non-string / null / undefined inputs — the repo's helpers never throw on bad input), and the
  honesty/clamp invariants where relevant (score 0–100, `NO_ANSWER`, salary scoping).
- Prefer dependency injection for network/DOM (see `replyGenerate.js` `deps.callDeepSeek`,
  `resumeBump`-style mock frames) so tests stay offline and deterministic — no real fetch, no browser.

## Determinism
- Tests must not call the network, launch a browser, read real account PII, or depend on
  `Date.now()` / wall-clock. Pass explicit `Date`/timestamps (see `schedule.js`, `daemonPlan.js`).

## CI (`.github/workflows/ci.yml`)
- CI runs `npm test` on every push/PR with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (pure tests only).
- `npm ci` needs `package-lock.json` committed — if CI install fails, that's the cause.
- Safe additions when extending CI: `node --check` smoke as a separate step, ESLint (`@eslint/js`
  flat config) and `c8` coverage, `markdownlint-cli` for docs. Any new dev-dependency still needs
  user approval per `common.md` (keep runtime deps = Node builtins + Playwright).

## Optional local tooling (only if approved)
- Lint: ESLint flat config. Coverage: `c8 node --test`. Docs: `markdownlint-cli '**/*.md'`.
  Don't introduce these silently — propose, get approval, then wire into CI.
