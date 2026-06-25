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
2026-06-25 | M2.2 | DONE | callDeepSeek: ретрай с backoff (500/1000мс) на transient (0/429/5xx), НЕ на 402/4xx; maxRetries=2, инъекция sleep для тестов. +5 тестов (счётчики вызовов, последовательность задержек). Старый network-тест переведён на no-op sleep. implementer→code-reviewer(APPROVE w/nits). npm test 88/88 за 240мс.
2026-06-25 | M2.3 | DONE | redactSecrets (по имени ключа, 1 уровень рекурсии) + appendDeepSeekDebug пропускает записи через него; +4 теста. implementer→security-reviewer(PASS, документ. ограничение: не ловит секрет в ЗНАЧЕНИИ — инстинкт debug-redaction-is-key-name-only). npm test 92/92. M2 ЗАВЕРШЁН.
2026-06-25 | M3.9/M3.10 (модули) | DONE | src/lib/vacancyExtract.js (extractRequirements) + src/lib/resumeProfile.js (buildResumeProfile) + тесты (15). Чистые, review.js не тронут. code-reviewer APPROVE + заметки для проводки (substring-маркеры, профиль — только в локальный скоринг). npm test 107/107. Проводка отдельным шагом.
2026-06-25 | M3.9 (проводка) | DONE | scoreVacancyWithDeepSeek шлёт extractRequirements(vacancyText) (<=1500) вместо ~9000 симв.; маркеры закрыты lookbehind от substring-срабатываний. Форма/сбор сигналов получают полный текст без изменений. +2 теста. self-review оркестратора (scope: 1 строка, gate/honesty не тронуты). npm test 109/109. Замечание: A/B против живого API недоступен — порог min-score остаётся страховкой.
2026-06-25 | M3.2/M3.10 | DONE | src/lib/localScore.js (localRelevanceScore, needsModelScoring) + проводка local-first в reviewVacancy: уверенный локальный reject пропускает DeepSeek (0 токенов). БЕЗОПАСНАЯ политика: локальный скоринг только ОТКЛОНЯЕТ, никогда не пропускает к отклику без модели; low привязан к minScore. resumeProfile (M3.10) — основа для локальной логики. +10 тестов. code-reviewer APPROVE w/nits (инвариант подтверждён, нит low<->minScore закрыт). npm test 119/119.
