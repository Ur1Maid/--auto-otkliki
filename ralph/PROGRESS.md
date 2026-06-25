# PROGRESS — журнал Ralph (append-only)

Каждая итерация дописывает сюда одну запись. Формат:
`YYYY-MM-DD HH:MM | <ID> | DONE|BLOCKED | что сделано / прогнал / результат`

---

2026-06-24 | M0.1 | DONE | bootstrap: `npm test` + `test/smoke.test.mjs` (node --check на всех src/*.js).
2026-06-24 | M0.2 | DONE | bootstrap: ralph/ (PROMPT, ROADMAP, ralph.ps1, ralph.sh, README), ветка ralph/auto.
2026-06-25 | M1.1 | DONE | src/lib/text.js (parseJsonObject, cleanGeneratedAnswer) + test/text.test.mjs (12). implementer(Sonnet)→code-reviewer(APPROVE)→npm test 19/19. looksLikeEmployerVoice оставлен (M1.5).
2026-06-25 | M1.2 | DONE | src/lib/fields.js (detectFieldKind, isSalaryContext, isGenericFieldContext, getMainQuestion) + test/fields.test.mjs (22). implementer(Sonnet)→code-reviewer(APPROVE w/nits, blank-line fixed)→npm test 41/41.
