# Instincts — project memory of hard-won patterns

Adapted from ECC's continuous-learning ("instinct") system, scaled down to a single repo and
kept in-tree so it's versioned and shared with the team (no external data home, no background hooks).

An **instinct** is a small, reusable lesson learned the hard way in this codebase: a trap, a gotcha,
or a pattern that works. Capture one whenever you discover something non-obvious that would have
saved you time if you'd known it up front. Agents and the orchestrator skim this folder during the
`research-first` step.

## File format

One instinct per file, `kebab-case-name.md`, YAML frontmatter + body:

```markdown
---
name: hh-selectors-text-based
confidence: 0.9          # 0–1: how reliably this has held up. Raise on re-confirm, lower on counterexample.
created: 2026-06-24
tags: [playwright, hh-ru, selectors]
---

# Action
What to do (or avoid) when this situation appears.

# Evidence
Why it's true — the observation/incident that established it, with file:line if relevant.

# Examples
Concrete code or a real case.
```

## Lifecycle (manual)
- **Capture:** use the `capture-instinct` skill (or just add a file) right after solving something tricky.
- **Confirm:** when an instinct helps again, bump `confidence`. When it's contradicted, lower it or fix it.
- **Prune:** delete instincts that become wrong (e.g. a refactor removes the trap). Don't keep stale lore.
- **Promote:** if several instincts cluster into a repeatable workflow, fold them into a rule
  (`.claude/rules/`) or a skill (`.claude/skills/`).

This is a deliberately lightweight, file-based version of ECC's `/instinct-status`, `/evolve`,
`/prune`. The discipline matters more than the tooling.
