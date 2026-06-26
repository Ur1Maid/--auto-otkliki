---
name: research-first
description: >-
  Evidence-before-code checkpoint for this repo. Use BEFORE changing a Playwright selector, a
  DeepSeek prompt, the apply flow, or anything whose "correct" shape depends on the live hh.ru DOM
  or the DeepSeek API contract. Forces you to gather and cite evidence first, so changes rest on
  verified facts instead of assumptions.
---

# Research-first development

Adapted from ECC's research-first philosophy: gather evidence, then implement. In this project the
two big sources of silent breakage are (a) the **live hh.ru DOM** (Russian UI, changes without
notice) and (b) the **DeepSeek output contract** (JSON shape, fences, model drift). Guessing at
either produces code that "looks right" and fails in production.

## When to run this
- Adding/altering a Playwright locator or page-state detection.
- Changing a DeepSeek system/user prompt, temperature, `max_tokens`, or output parsing.
- Touching the apply/submit flow or relevance scoring.
- Adding a CLI flag that changes behavior.

## The checklist

1. **Read the current implementation.** Find the exact code and cite it as `file:line`. Summarize
   what it does today and what contract it relies on. (e.g. "`findResponseButton` matches
   `RESPONSE_BUTTON_TEXTS` via `getByRole` — review.js:340".)

2. **Gather ground truth.**
   - DOM/selectors: get the *actual* current page — ask the user to paste the relevant HTML or a
     screenshot, or read it via a running browser. Note the real Russian label/role.
   - DeepSeek: check the OpenAI-compatible chat-completions contract and the real responses in
     `logs/deepseek-debug.jsonl` (run with `--debug-ai`). Note actual output shape, fences, edge cases.
   - Library/API docs: if a Playwright or Node API is in question, verify against current docs, not
     memory.

3. **Check the instincts.** Skim `.claude/instincts/` for a recorded trap that already covers this.

4. **Write the evidence down** in your plan/report: the citations, the observed ground truth, and
   the specific contract the change must honor. *No evidence → no change.*

5. **Only then implement** (delegate to the `implementer`), and verify against the evidence you
   gathered, not against what you expected.

## Output
A short evidence note: current behavior (`file:line`), observed ground truth, the contract to honor,
and any new instinct worth capturing (see the `capture-instinct` skill).
