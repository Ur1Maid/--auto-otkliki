# JavaScript / Node rules

Applies to everything under `src/`.

## Module system & runtime
- ESM only: `import` / `export`, no `require`. The package is `"type": "module"`.
- Use `node:`-prefixed builtins (`node:fs/promises`, `node:path`, `node:url`, `node:readline/promises`).
- Target Node `>=20`. Modern APIs are fair game: `fetch`, `AbortSignal.timeout`, top-level `await`
  (used in `src/check.js`), `structuredClone`, etc.

## Style (match the existing code)
- `async`/`await` throughout; no `.then()` chains for sequential logic. `.catch(() => fallback)`
  is the established pattern for "best-effort" Playwright/network calls — keep it.
- Small, single-purpose helper functions, named with verbs (`collectFromSearch`, `askDeepSeek`,
  `parseJsonObject`). Pure helpers at module top, side-effecting flow lower down.
- Two-space indentation, single quotes, semicolons, trailing commas where the file already uses them.
- Console/log output is in **Russian** to match the existing UX. Keep it.
- Prefer `const`; `let` only when reassigned. Use early `return` / `continue` over deep nesting.

## Robustness
- Validate CLI args defensively as `parseArgs` does (`Number.isFinite`, range checks, throw with a
  clear Russian message).
- Wrap fallible external calls (DOM reads, network) so one failure never aborts a multi-account run.
- Clamp/normalize anything coming from the model or the page (e.g. `Math.max(0, Math.min(100, score))`).

## Don't
- Don't add a transpiler, bundler, test framework, or TypeScript without explicit approval.
- Don't introduce a logging library — the project uses `console.log` + append-only JSONL.
- Don't swallow errors silently in *new* logic paths that affect correctness; degrade *intentionally*.
