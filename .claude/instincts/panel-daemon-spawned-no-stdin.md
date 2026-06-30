---
name: panel-daemon-spawned-no-stdin
confidence: 0.95
created: 2026-07-01
tags: [electron, daemon, spawn, safety, live, stdin, playwright]
---

# Action
LIVE actions started from the **panel/daemon/Electron** must NOT depend on an
interactive terminal. Two concrete rules, both load-bearing:

1. **Spawn internal children as real Node.** Every `spawn(process.execPath, …)`
   must pass `env: nodeSpawnEnv()` (`src/lib/spawnEnv.js`, sets
   `ELECTRON_RUN_AS_NODE='1'`). Under Electron, `process.execPath` is `electron.exe`;
   without that flag the child runs as an Electron *app*, not Node, and Playwright /
   navigation **hang** (apply stuck at `phase: collecting`). Wired at all 3 sites:
   `electron-main.js` (→ dashboard), `taskRunner.js` (→ daemon), `daemon.js` `spawnNode`
   (→ review). Under plain `node` the var is ignored (no-op), so it's always safe.

2. **No stdin confirmation traps.** `confirm()`/`ask()` in `src/prompts.js` are
   TTY-aware via `resolveConfirmPolicy({isTTY, autoFlag})` (`src/lib/confirmPolicy.js`):
   no TTY + no auto-flag → `decline` (return `false`/default) instead of blocking on
   `readline.question` forever. Operator consent for a panel LIVE run = the **Live
   opt-in toggle + confirm() dialog in the GUI**, not a per-action `[y/N]` on a stdin
   that doesn't exist. Messages send autonomously only when launched with `--reply-auto`
   (passed by `buildTaskCommand` ONLY when `live===true`); dry-run/non-live send nothing
   (`decideSend` gate unchanged: `replyAuto===true` strictly).

# Evidence
Prod incident 2026-07-01 (account belonogov, panel-launched): (a) `daemon.js --task apply
… --live` hung at heartbeat `phase: collecting, index: 0` — children were running under
`electron.exe` without `ELECTRON_RUN_AS_NODE`; nothing was submitted. (b) `--task messages`
found 2 unread threads, generated an honest reply, then blocked on
`[daemon] Отправить ответ в чате? [y/N]` (daemon.js:212 → prompts.js `confirm` →
`readline.question` on a non-TTY stdin inherited up the panel→dashboard→daemon chain) —
the prompt was unreachable from the GUI, so it hung; nothing was sent. Both stopped
manually; verified no real applies (responses log untouched) and no message sent.

# Examples
```js
// spawnEnv.js — always-safe under both node and electron
export function nodeSpawnEnv(baseEnv = process.env) {
  return { ...baseEnv, ELECTRON_RUN_AS_NODE: '1' };
}
// caller
spawn(process.execPath, [child, ...args], { stdio: 'inherit', env: nodeSpawnEnv() });
```
Follow-up (not yet built): a **per-action confirmation modal in the panel itself**
(approve each real apply/send in the GUI) would restore human-in-the-loop without a
terminal. Until then, the panel Live toggle is the single consent point — treat a Live
launch as authorizing the whole autonomous run. See [[hh-chatik-inline-not-iframe]] and
[[hh-selectors-text-based]]: a passing mock unit test does NOT prove the live flow works —
the real proof is a supervised dry-run→small-live run (`verify-live-flow`).
