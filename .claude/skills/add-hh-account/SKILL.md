---
name: add-hh-account
description: >-
  Scaffold and onboard a new hh.ru account in this repo (config folder, resume.md, salary.md,
  saved login session). Use when the user wants to add an account, set up multi-account runs, or
  asks why an account isn't being picked up.
---

# Add an hh.ru account

Each account is fully isolated: its own config folder, resume, salary rules, log file, and saved
browser session. Account names are normalized via `normalizeAccountName` (lowercased-ish, non
`\w.-` → `-`). The reserved name is `default`.

## Steps

1. **Pick a normalized name** (e.g. `acc1`, `startsev`). Confirm it doesn't collide with an existing
   folder under `config/accounts/`.

2. **Create the config folder + files** (PowerShell):
   ```powershell
   New-Item -ItemType Directory -Force config\accounts\<name>
   Copy-Item config\accounts\example\resume.example.md config\accounts\<name>\resume.md
   Copy-Item config\accounts\example\salary.example.md config\accounts\<name>\salary.md
   ```
   If you skip this, `review` auto-creates templates on first run — but they must be filled before a
   real run.

3. **Fill the data (PII — stays local, git-ignored):**
   - `resume.md`: target role, stack, experience, work format, constraints. Add a `## Contacts` /
     `## Контакты` block with `Telegram: @username` if you want the model to use it.
   - `salary.md`: expected amount/range, gross/net, floor, how to answer salary questions.

4. **Log in and save the session** (headful browser opens — log in manually):
   ```powershell
   npm.cmd run login -- --account <name>
   ```
   Saves to `.hh-session/accounts/<name>/storage-state.json` (git-ignored, = live credentials).

5. **Verify** the account is wired up with a tiny dry run:
   ```powershell
   npm.cmd run review:manual -- --account <name> --text DevOps --area 1 --limit 5
   ```
   Use `--manual` so nothing is submitted without confirmation.

## Multi-account run
```powershell
npm.cmd run review -- --accounts acc1,acc2,acc3 --text DevOps --area 1 --limit 200
```

## Guardrails
- Never commit `resume.md`, `salary.md`, or the session file — confirm `.gitignore` covers them.
- Keep each account's data scoped to its own folder; don't reference another account's files.
- Telegram/contacts only in that account's `resume.md`.
