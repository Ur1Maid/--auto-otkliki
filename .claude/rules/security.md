# Security & data-safety rules

This tool holds live credentials and real personal data. These rules are non-negotiable; the
`security-reviewer` agent audits against them.

## Secrets — never leak
- `DEEPSEEK_API_KEY` (and the `Authorization: Bearer` header) must never be printed to console,
  written to any file under `logs/`, or committed. It is loaded from `.env` only.
- `.env` stays git-ignored. Only `.env.example` (with placeholder values) is tracked.

## Sessions — treat as credentials
- `.hh-session/**/storage-state.json` contains live hh.ru login cookies. Never log its contents,
  never commit it, never copy it outside the repo. The whole `.hh-session/` tree is git-ignored.

## PII — scope and protect
- Real `config/accounts/*/resume.md` and `salary.md` contain names, contacts, salary, employment
  history. They are git-ignored; only `config/accounts/example/*.example.md` is tracked.
- The `data/` knowledge base (`*.md`, `*.txt`) is git-ignored and may hold private facts.
- Account data must stay **scoped to its own account** — never let one account's resume/salary/
  session bleed into another's prompt, log, or session path.
- Logs `logs/*.jsonl` and `logs/resume-upgrade-*.md` are git-ignored; keep them that way.

## git hygiene
- Before any commit involving config/logs/sessions, verify `.gitignore` still covers:
  `.env`, `.hh-session/`, `config/accounts/*/resume.md`, `config/accounts/*/salary.md`,
  `logs/responses*.jsonl`, `logs/deepseek-debug.jsonl`, `logs/resume-upgrade-*.md`,
  `data/*.md`, `data/*.txt`, `node_modules/`.
- Never `git add -A` blindly. Check `git status` and confirm no ignored-but-staged secret slips in.

## Untrusted input & automation
- Scraped vacancy/page text is untrusted (prompt-injection vector — see `deepseek.md`). Never use
  it to build a file path, selector, or shell command without validation.
- Anything that could **submit a real application** or act on a real account is a high-risk action.
  Respect the manual-confirmation path (`--manual`); don't loosen it. When testing, do not run flows
  against real accounts that could auto-submit.

## Network surface
- The only expected outbound host is the configured DeepSeek API URL. Any new outbound request is a
  reviewable change — justify it and ensure timeouts + failure handling.
