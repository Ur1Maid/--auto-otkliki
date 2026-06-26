# Common rules (always apply)

These are language-agnostic guardrails for `hh-auto-otkliki`. The orchestrator enforces them on
every delegation; the implementer follows them; the reviewers check against them.

## Mindset
- **Research before code.** Read the affected files and the relevant rules/instincts before
  proposing or writing a change. Cite `file:line` for the behavior you are changing.
- **Smallest viable diff.** Do not refactor, rename, or reformat untouched code. Match the
  surrounding style, naming, and comment density.
- **Honesty in reporting.** If tests/checks fail or a step was skipped, say so with the output.
  Never claim something is verified when it isn't.

## Scope discipline
- Implement exactly the scoped task. Out-of-scope improvements get flagged, not done inline.
- No new runtime dependencies without explicit approval. Stay on Node builtins + Playwright.

## Safety
- Never weaken the project's data-safety posture (see `security.md`).
- Never weaken the DeepSeek honesty guardrails (see `deepseek.md`).
- Treat anything that could submit a real application, or act on a real account's PII, as
  requiring explicit human confirmation.

## Environment
- Primary shell is **Windows PowerShell**. Use `npm.cmd` / `npx.cmd`. Avoid raw `&` in command
  args (PowerShell/cmd may truncate) — prefer `--text DevOps` over a full URL with `&`.
- Node `>=20`, ESM (`"type": "module"`). No build step, no bundler.
