---
name: capture-instinct
description: >-
  Record a hard-won lesson about this codebase as an instinct file under .claude/instincts/. Use
  right after solving something non-obvious (an hh.ru UI break, a DeepSeek parsing quirk, a Windows
  shell gotcha) so it's not re-learned next time. Also use to bump/lower confidence or prune a
  stale instinct.
---

# Capture an instinct

Lightweight, in-tree version of ECC's continuous-learning loop. An instinct = one small, reusable
lesson. See `.claude/instincts/README.md` for the full format.

## To capture
1. Confirm it's genuinely non-obvious and reusable (not already covered by a rule, skill, or
   existing instinct — skim `.claude/instincts/` first).
2. Create `.claude/instincts/<kebab-name>.md` with frontmatter
   (`name`, `confidence` 0–1, `created` YYYY-MM-DD, `tags`) and the body sections **Action /
   Evidence / Examples**. Cite `file:line` in Evidence where you can.
3. Set initial `confidence` honestly: ~0.6 for "seen once", ~0.9 for "this is clearly structural".

## To maintain
- **Confirm:** an instinct helped again → bump `confidence` toward 1.0.
- **Contradict:** reality disagreed → lower `confidence` or correct the Action.
- **Prune:** the trap no longer exists (e.g. refactor removed it) → delete the file.
- **Promote:** several related instincts → fold into `.claude/rules/` or a skill.

## Guardrails
- Never put secrets, API keys, or real PII in an instinct (these files ARE committed). Use
  structural/illustrative examples only.
- Keep it to one lesson per file. Vague observations ("could be cleaner") are not instincts.
