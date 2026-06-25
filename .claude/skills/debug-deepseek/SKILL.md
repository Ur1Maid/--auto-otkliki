---
name: debug-deepseek
description: >-
  Diagnose DeepSeek behavior in this repo — bad relevance scores, empty/NO_ANSWER fields, wrong
  choices, rejected cover letters, parse failures, or API errors (402 balance, timeouts). Use when
  the AI side misbehaves or you need to inspect what was actually sent/received.
---

# Debug DeepSeek

All model I/O can be captured to `logs/deepseek-debug.jsonl` (append-only JSONL, **never contains
the API key**). It's only written when the run includes `--debug-ai`.

## Reproduce with debug on
```powershell
npm.cmd run review:manual -- --account <name> --text DevOps --area 1 --limit 5 --debug-ai
```

## Read the log
Each line is one phase. Key `phase` values and where they come from in `src/review.js`:
- `relevance-request` / `relevance-response` / `relevance-error` — vacancy scoring
  (`scoreVacancyWithDeepSeek`). Check `score`/`reason`, raw answer, and HTTP status on error.
- `form-request` / `form-response` / `form-error` — the batched form fill (`askDeepSeekForm`).
  Inspect `fieldCount`, `choiceGroupCount`, `parsed`, and the raw answer for fenced/malformed JSON.
- `request`/`response`, `choice-request`/`choice-response` — single-field and choice paths.
- `resume-upgrade-request` / `resume-upgrade-response` — `--upgrade-resume` reports.

Useful filters (PowerShell):
```powershell
Get-Content logs\deepseek-debug.jsonl | Select-String '"phase":"form-error"'
Get-Content logs\deepseek-debug.jsonl | Select-Object -Last 20
```

## Common symptoms → likely cause
- **All scores 0, reason `deepseek_insufficient_balance`** → HTTP 402, top up the DeepSeek key.
- **All scores 0, reason `relevance_check_failed`** → network/timeout or non-OK status; check
  `relevance-error.status`/`body`.
- **`reason: parse_failed` / empty fields** → model returned non-JSON or fenced JSON the parser
  missed. Verify the raw answer; confirm parsing still goes through `parseJsonObject`. Consider a
  lower temperature or tighter format instruction — but DON'T weaken honesty guardrails.
- **Cover letter blanked out** → `looksLikeEmployerVoice` rejected employer-voice text (working as
  intended). Look at `rejectedEmployerVoice: true`.
- **Field skipped, "не удалось понять контекст"** → `detectFieldKind` returned `unknown`; the field
  context was generic. Improve context extraction in `getFieldContext`, not the prompt.

## Rules while debugging
- Don't disable or loosen the honesty guardrails or `NO_ANSWER` path to "fix" an empty answer —
  an empty answer is often correct (the model couldn't answer honestly).
- Never paste real PII or the API key into a report. Quote only the structural parts of log entries.
- If you change parsing/prompt, run `research-first` and re-capture the debug log to confirm.
