# PROGRESS — журнал Ralph (append-only)

Каждая итерация дописывает сюда одну запись. Формат:
`YYYY-MM-DD HH:MM | <ID> | DONE|BLOCKED | что сделано / прогнал / результат`

---

2026-06-24 | M0.1 | DONE | bootstrap: `npm test` + `test/smoke.test.mjs` (node --check на всех src/*.js).
2026-06-24 | M0.2 | DONE | bootstrap: ralph/ (PROMPT, ROADMAP, ralph.ps1, ralph.sh, README), ветка ralph/auto.
2026-06-25 | M1.1 | DONE | src/lib/text.js (parseJsonObject, cleanGeneratedAnswer) + test/text.test.mjs (12). implementer(Sonnet)→code-reviewer(APPROVE)→npm test 19/19. looksLikeEmployerVoice оставлен (M1.5).
2026-06-25 | M1.2 | DONE | src/lib/fields.js (detectFieldKind, isSalaryContext, isGenericFieldContext, getMainQuestion) + test/fields.test.mjs (22). implementer(Sonnet)→code-reviewer(APPROVE w/nits, blank-line fixed)→npm test 41/41.
2026-06-25 | M1.3 | DONE | src/lib/knowledge.js (RESUME_KEYWORDS[58], normalizeText, getSearchTerms, extractResumeKeywords, pickKnowledgeChunks) + test/knowledge.test.mjs (15). implementer→code-reviewer(APPROVE)→npm test 56/56.
2026-06-25 | M1.4 | DONE | src/lib/urls.js (normalizeHhUrl, normalizeVacancyUrl) + test/urls.test.mjs (6). implementer→self-review оркестратора (тривиальные URL-функции, byte-identical)→npm test 62/62.
2026-06-25 | M1.5 | DONE | src/lib/answers.js (matchesAnyPattern, looksLikeEmployerVoice, optionMatches; импортит normalizeText из knowledge) + test/answers.test.mjs (14). implementer→code-reviewer(APPROVE w/nits): honesty-регэксп employer-voice байт-в-байт; убран осиротевший импорт normalizeText. npm test 76/76. M1 ЗАВЕРШЁН.
2026-06-25 | M2.1 | DONE | src/lib/deepseek.js (callDeepSeek, byte-identical) + test/deepseek.test.mjs (7, fetch замокан). implementer→security-reviewer(PASS): ключ только в Authorization-заголовке, не логируется/не возвращается; сеть/timeout/деградация сохранены. npm test 83/83.
