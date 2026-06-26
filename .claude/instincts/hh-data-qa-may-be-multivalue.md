---
name: hh-data-qa-may-be-multivalue
confidence: 0.9
created: 2026-06-26
tags: [playwright, hh-ru, selectors, data-qa]
---

# Action
hh.ru `data-qa` attributes can be **multi-valued** (space-separated tokens), not single strings.
Match a token with the CSS word-list operator `[data-qa~="token"]`, **not** exact `[data-qa="token"]`
— exact match returns 0 nodes when the live attribute carries extra tokens. When unsure, read the
live DOM (`el.getAttribute('data-qa')`) before committing the selector.

# Evidence
The resume bump button on `hh.ru/applicant/resumes` renders as
`data-qa="resume-update-button resume-update-button_actions"` (verified live 2026-06-26). The
M5.1/M5.4 selector was written as `[data-qa="resume-update-button"]` from a static resume HTML and
silently matched **zero** nodes on the live page → `bumpResume` always returned `not_found`; the
daemon's MICRO_EDIT step never actually bumped. Unit tests passed (mocked frame) so this was only
caught by a live dry-run. Fix: `[data-qa~="resume-update-button"]` → 1 node, classified `ready`.

# Examples
```js
// WRONG — exact match, breaks on multi-value data-qa:
'[data-qa="resume-update-button"]'           // 0 nodes on live page
// RIGHT — token in space-separated list:
'[data-qa~="resume-update-button"]'          // matches "resume-update-button resume-update-button_actions"
```
Related: prefix/suffix matching already used in the chat registry (`[data-qa^="chatik-open-chat-"]`,
`[data-qa$="-text"]`). See [[hh-selectors-text-based]] — prefer role+text; when you must use
`data-qa`, account for multi-value. A passing unit test on a mocked frame does NOT prove a selector
matches the live DOM — verify selector changes with a live dry-run.
