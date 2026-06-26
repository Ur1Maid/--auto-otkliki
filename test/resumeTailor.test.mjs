import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDivergence,
  withinDivergenceLimit,
  applyAdditiveSkills,
  tailorResume,
  backupFileName,
  DEFAULT_MAX_CHANGED_LINES,
  DEFAULT_MIN_SIMILARITY,
} from '../src/lib/resumeTailor.js';

// ─── computeDivergence ────────────────────────────────────────────────────────

test('computeDivergence: идентичные тексты → changedLines 0, similarity 1', () => {
  const text = '# Резюме\n\nОпыт: Docker\n- Строка';
  const d = computeDivergence(text, text);
  assert.equal(d.changedLines, 0);
  assert.equal(d.similarity, 1);
  assert.equal(d.addedLines, 0);
  assert.equal(d.removedLines, 0);
});

test('computeDivergence: пустые строки → changedLines 0, similarity 1', () => {
  const d = computeDivergence('', '');
  assert.equal(d.changedLines, 0);
  assert.equal(d.similarity, 1);
});

test('computeDivergence: добавлена 1 строка → addedLines 1, similarity < 1', () => {
  const orig = 'строка1\nстрока2';
  const mod = 'строка1\nстрока2\nновая строка';
  const d = computeDivergence(orig, mod);
  assert.equal(d.addedLines, 1);
  assert.equal(d.removedLines, 0);
  assert.equal(d.changedLines, 1);
  assert.ok(d.similarity < 1, `similarity должна быть < 1, получено ${d.similarity}`);
});

test('computeDivergence: удалена 1 строка → removedLines 1', () => {
  const orig = 'строка1\nстрока2\nстрока3';
  const mod = 'строка1\nстрока2';
  const d = computeDivergence(orig, mod);
  assert.equal(d.removedLines, 1);
  assert.equal(d.addedLines, 0);
  assert.equal(d.changedLines, 1);
});

test('computeDivergence: полностью разные тексты → similarity низкая', () => {
  const orig = 'aaa\nbbb\nccc';
  const mod = 'xxx\nyyy\nzzz';
  const d = computeDivergence(orig, mod);
  assert.ok(d.similarity < 0.5, `similarity должна быть низкой, получено ${d.similarity}`);
  assert.equal(d.addedLines, 3);
  assert.equal(d.removedLines, 3);
  assert.equal(d.changedLines, 6);
});

test('computeDivergence: не-строки → guard, пустая строка при не-строковом вводе', () => {
  const d = computeDivergence(null, undefined);
  assert.equal(d.changedLines, 0);
  assert.equal(d.similarity, 1);
  assert.equal(d.originalLines, 1); // ''.split('\n') = ['']
  assert.equal(d.modifiedLines, 1);
});

test('computeDivergence: мультимножество — дублирующиеся строки считаются правильно', () => {
  // original: 2×'x', modified: 3×'x' → добавлена 1 строка
  const orig = 'x\nx';
  const mod = 'x\nx\nx';
  const d = computeDivergence(orig, mod);
  assert.equal(d.addedLines, 1);
  assert.equal(d.removedLines, 0);
  assert.equal(d.changedLines, 1);
});

test('computeDivergence: мультимножество — удаление дубля', () => {
  const orig = 'x\nx\nx';
  const mod = 'x\nx';
  const d = computeDivergence(orig, mod);
  assert.equal(d.removedLines, 1);
  assert.equal(d.addedLines, 0);
});

test('computeDivergence: возвращает правильные поля originalLines и modifiedLines', () => {
  const orig = 'a\nb\nc';
  const mod = 'a\nb\nc\nd';
  const d = computeDivergence(orig, mod);
  assert.equal(d.originalLines, 3);
  assert.equal(d.modifiedLines, 4);
});

// ─── withinDivergenceLimit ────────────────────────────────────────────────────

test('withinDivergenceLimit: в пределах → true', () => {
  // 3 строки + 1 новая: similarity = 2*3/(3+4) ≈ 0.857 >= DEFAULT_MIN_SIMILARITY=0.85
  const d = computeDivergence('a\nb\nc', 'a\nb\nc\nd');
  assert.ok(d.changedLines <= DEFAULT_MAX_CHANGED_LINES, 'changedLines в пределах');
  assert.ok(d.similarity >= DEFAULT_MIN_SIMILARITY, `similarity ${d.similarity} >= ${DEFAULT_MIN_SIMILARITY}`);
  assert.equal(withinDivergenceLimit(d), true);
});

test('withinDivergenceLimit: превышение changedLines → false', () => {
  const orig = Array.from({ length: 5 }, (_, i) => `строка${i}`).join('\n');
  // modified добавляет 9 строк (DEFAULT_MAX_CHANGED_LINES=8)
  const mod = orig + '\n' + Array.from({ length: 9 }, (_, i) => `new${i}`).join('\n');
  const d = computeDivergence(orig, mod);
  assert.equal(withinDivergenceLimit(d), false);
});

test('withinDivergenceLimit: similarity ниже порога → false', () => {
  const d = computeDivergence('a\nb\nc', 'x\ny\nz');
  assert.equal(withinDivergenceLimit(d), false);
});

test('withinDivergenceLimit: кастомные лимиты работают', () => {
  // 3 строки + 1 новая: changedLines=1, similarity ≈ 0.857 >= 0.85 → дефолт true
  const d = computeDivergence('строка1\nстрока2\nстрока3', 'строка1\nстрока2\nстрока3\nновая');
  assert.equal(withinDivergenceLimit(d), true, 'по умолчанию должно быть в пределах');
  // С maxChangedLines=0 — превышение
  assert.equal(withinDivergenceLimit(d, { maxChangedLines: 0 }), false);
  // С minSimilarity=0.99 — слишком высокий порог
  assert.equal(withinDivergenceLimit(d, { minSimilarity: 0.99 }), false);
});

test('withinDivergenceLimit: divergence не объект → false', () => {
  assert.equal(withinDivergenceLimit(null), false);
  assert.equal(withinDivergenceLimit(undefined), false);
  assert.equal(withinDivergenceLimit('строка'), false);
  assert.equal(withinDivergenceLimit(42), false);
});

test('withinDivergenceLimit: minSimilarity вне [0,1] → используется DEFAULT_MIN_SIMILARITY', () => {
  // identity: changedLines=0, similarity=1 — должно быть в пределах при любом корректном дефолте
  const d = computeDivergence('текст', 'текст');
  assert.equal(withinDivergenceLimit(d, { minSimilarity: -0.5 }), true);
  assert.equal(withinDivergenceLimit(d, { minSimilarity: 1.5 }), true);
});

test('withinDivergenceLimit: maxChangedLines некорректный → DEFAULT_MAX_CHANGED_LINES', () => {
  // identity: changedLines=0, similarity=1 — гарантированно в пределах при любом дефолте
  const d = computeDivergence('a\nb\nc', 'a\nb\nc');
  // changedLines=0 <= DEFAULT_MAX_CHANGED_LINES=8 и similarity=1 → должно быть true
  assert.equal(withinDivergenceLimit(d, { maxChangedLines: null }), true);
  assert.equal(withinDivergenceLimit(d, { maxChangedLines: -1 }), true);
});

// ─── applyAdditiveSkills ──────────────────────────────────────────────────────

test('applyAdditiveSkills: пустой approvedSkills → текст БАЙТ-В-БАЙТ, addedSkills []', () => {
  const resume = '# Резюме\n\nОпыт: Docker\n';
  const result = applyAdditiveSkills(resume, []);
  assert.equal(result.text, resume, 'текст должен быть идентичен исходному (байт-в-байт)');
  assert.deepEqual(result.addedSkills, []);
});

test('applyAdditiveSkills: approvedSkills не массив → текст без изменений', () => {
  const resume = 'Навыки: Docker';
  const result = applyAdditiveSkills(resume, null);
  assert.equal(result.text, resume);
  assert.deepEqual(result.addedSkills, []);
});

test('applyAdditiveSkills: resumeText не строка → guard к «»', () => {
  const result = applyAdditiveSkills(null, ['Terraform']);
  // текст — пустая строка + добавленный навык
  assert.equal(typeof result.text, 'string');
  assert.ok(result.addedSkills.includes('Terraform'));
});

test('applyAdditiveSkills: добавление в резюме С заголовком навыков (вставка после заголовка)', () => {
  const resume = '# Опыт\n- Docker\n\n## Навыки\n- Python\n\n## Образование\nМГУ';
  const result = applyAdditiveSkills(resume, ['Terraform']);
  assert.ok(result.addedSkills.includes('Terraform'), 'Terraform должен быть в addedSkills');
  // Terraform должен появиться сразу после заголовка ## Навыки
  const navykiIdx = result.text.indexOf('## Навыки');
  const terraformIdx = result.text.indexOf('Terraform');
  assert.ok(navykiIdx !== -1, 'заголовок Навыки должен быть');
  assert.ok(terraformIdx > navykiIdx, 'Terraform должен идти после ## Навыки');
  // Образование тоже должно быть после (не затронуто)
  const educationIdx = result.text.indexOf('## Образование');
  assert.ok(educationIdx > terraformIdx, '## Образование идёт после добавленного навыка');
});

test('applyAdditiveSkills: добавление в резюме БЕЗ заголовка навыков → новый блок в конце', () => {
  const resume = '# Опыт\n- Docker\n\n## Образование\nМГУ';
  const result = applyAdditiveSkills(resume, ['Ansible']);
  assert.ok(result.addedSkills.includes('Ansible'), 'Ansible должен быть в addedSkills');
  assert.ok(result.text.includes('## Дополнительные навыки'), 'должен появиться заголовок блока');
  assert.ok(result.text.includes('Ansible'), 'Ansible должен присутствовать в тексте');
  // Исходный заголовок ## Образование остался
  assert.ok(result.text.includes('## Образование'));
});

test('applyAdditiveSkills: заголовок "Skills" (английский) распознаётся', () => {
  const resume = '# CV\n\n## Skills\n- Python\n';
  const result = applyAdditiveSkills(resume, ['Terraform']);
  assert.ok(result.addedSkills.includes('Terraform'));
  const skillsIdx = result.text.indexOf('## Skills');
  const terraformIdx = result.text.indexOf('Terraform');
  assert.ok(terraformIdx > skillsIdx, 'Terraform вставлен после ## Skills');
});

test('applyAdditiveSkills: пропуск уже присутствующего навыка (already_present)', () => {
  const resume = 'Опыт: Docker, Kubernetes.';
  const result = applyAdditiveSkills(resume, ['Docker', 'Terraform']);
  assert.ok(!result.addedSkills.includes('Docker'), 'Docker уже есть, не добавляется');
  assert.ok(result.addedSkills.includes('Terraform'), 'Terraform нет в резюме, добавляется');
  const skippedReasons = result.skipped.filter((s) => s.skill === 'Docker').map((s) => s.reason);
  assert.ok(skippedReasons.includes('already_present'), 'Docker должен быть в skipped с already_present');
});

test('applyAdditiveSkills: дедуп — дублирующиеся навыки в approvedSkills пропускаются', () => {
  const resume = 'Опыт работы.';
  const result = applyAdditiveSkills(resume, ['Ansible', 'ansible', 'ANSIBLE']);
  // Только первое вхождение добавляется
  assert.equal(result.addedSkills.length, 1);
  assert.equal(result.addedSkills[0], 'Ansible');
  const dupSkipped = result.skipped.filter((s) => s.reason === 'duplicate');
  assert.equal(dupSkipped.length, 2, 'два дублирующихся варианта в skipped');
});

test('applyAdditiveSkills: maxNewSkills обрезает (over_limit)', () => {
  const resume = 'Опыт работы.';
  const skills = ['Terraform', 'Ansible', 'Prometheus', 'Grafana', 'Loki'];
  const result = applyAdditiveSkills(resume, skills, { maxNewSkills: 2 });
  assert.equal(result.addedSkills.length, 2, 'не больше maxNewSkills=2 добавляется');
  const overLimit = result.skipped.filter((s) => s.reason === 'over_limit');
  assert.equal(overLimit.length, 3, 'оставшиеся 3 — в skipped с over_limit');
});

test('applyAdditiveSkills: maxNewSkills=0 → ничего не добавляется', () => {
  const resume = 'Опыт работы.';
  const result = applyAdditiveSkills(resume, ['Terraform'], { maxNewSkills: 0 });
  assert.equal(result.text, resume, 'текст не меняется при maxNewSkills=0');
  assert.deepEqual(result.addedSkills, []);
  assert.ok(result.skipped.some((s) => s.reason === 'over_limit'));
});

test('applyAdditiveSkills: пустые строки в approvedSkills помечаются как empty', () => {
  const resume = 'Опыт работы.';
  const result = applyAdditiveSkills(resume, ['', '  ', 'Ansible']);
  assert.ok(result.addedSkills.includes('Ansible'));
  const emptySkipped = result.skipped.filter((s) => s.reason === 'empty');
  assert.equal(emptySkipped.length, 2);
});

test('honesty-инвариант: каждая исходная строка резюме присутствует в результате (additive-only)', () => {
  const resume = '# Опыт\n\n- Docker (2020–2025)\n- Настройка Kubernetes\n\n## Образование\nМГУ';
  const result = applyAdditiveSkills(resume, ['Terraform', 'Ansible']);
  // Каждая строка исходного резюме должна присутствовать в результате
  const origLines = resume.split('\n');
  const modText = result.text;
  for (const line of origLines) {
    assert.ok(modText.includes(line), `исходная строка «${line}» отсутствует в результате`);
  }
});

test('honesty-инвариант: applyAdditiveSkills добавляет ТОЛЬКО навыки из approvedSkills', () => {
  const resume = 'Опыт: Docker.';
  const approved = ['Terraform', 'Ansible'];
  const result = applyAdditiveSkills(resume, approved);
  for (const skill of result.addedSkills) {
    // Каждый добавленный навык должен быть в approvedSkills (регистронезависимо)
    assert.ok(
      approved.some((a) => a.toLowerCase() === skill.toLowerCase()),
      `«${skill}» добавлен, но не был в approvedSkills — НАРУШЕНИЕ HONESTY`,
    );
  }
});

// ─── tailorResume ─────────────────────────────────────────────────────────────

test('tailorResume: успешное применение в пределах лимита (applied: true)', () => {
  // Реалистичное резюме достаточной длины: вставка 1 строки после ## Навыки
  // даёт changedLines=1, similarity ≈ 0.966 >= DEFAULT_MIN_SIMILARITY=0.85
  const resume = [
    '# Иванов Иван',
    '',
    '## Опыт работы',
    '**2020–2025** — Старший DevOps-инженер',
    '- Linux, Docker, Kubernetes',
    '- GitLab CI/CD, Terraform, Ansible',
    '- Prometheus, Grafana, Loki',
    '',
    '## Навыки',
    '- Bash, Python',
    '- Nginx, PostgreSQL',
    '',
    '## Образование',
    'МГУ, Факультет ВМК, 2020',
  ].join('\n');

  const result = tailorResume(resume, { approvedSkills: ['ClickHouse'] });
  assert.equal(result.applied, true);
  assert.ok(result.tailored.includes('ClickHouse'), 'tailored содержит новый навык');
  assert.equal(result.original, resume);
  assert.ok(result.addedSkills.includes('ClickHouse'));
});

test('tailorResume: превышение лимита → applied:false, tailored===original, reason указан', () => {
  // Создаём ситуацию превышения: maxChangedLines=0
  const resume = '# Резюме\nДокер\n';
  const result = tailorResume(resume, {
    approvedSkills: ['Terraform'],
    limits: { maxChangedLines: 0 },
  });
  assert.equal(result.applied, false);
  assert.equal(result.tailored, result.original, 'tailored должен совпадать с original при откате');
  assert.equal(result.tailored, resume);
  assert.equal(result.reason, 'divergence_limit_exceeded');
  assert.deepEqual(result.addedSkills, []);
});

test('tailorResume: пустой approvedSkills → applied:true, tailored===original (дивергенция 0)', () => {
  const resume = 'Опыт: Docker.';
  const result = tailorResume(resume, { approvedSkills: [] });
  assert.equal(result.applied, true);
  assert.equal(result.tailored, result.original);
  assert.equal(result.tailored, resume);
  assert.deepEqual(result.addedSkills, []);
  assert.equal(result.divergence.changedLines, 0);
});

test('tailorResume: approvedSkills не указан → applied:true, tailored===original', () => {
  const resume = 'Опыт: Docker.';
  const result = tailorResume(resume, {});
  assert.equal(result.applied, true);
  assert.equal(result.tailored, resume);
});

test('tailorResume: без аргументов → не падает', () => {
  assert.doesNotThrow(() => {
    const result = tailorResume();
    assert.equal(typeof result.tailored, 'string');
  });
});

test('tailorResume: divergence присутствует в ответе всегда', () => {
  const result = tailorResume('текст', { approvedSkills: ['Ansible'] });
  assert.ok(result.divergence && typeof result.divergence === 'object', 'divergence должно быть объектом');
  assert.ok(typeof result.divergence.changedLines === 'number');
  assert.ok(typeof result.divergence.similarity === 'number');
});

// ─── backupFileName ───────────────────────────────────────────────────────────

test('backupFileName: точный формат на фиксированной дате', () => {
  const d = new Date('2026-06-26T09:05:03Z');
  assert.equal(backupFileName('resume.md', d), 'resume.md.20260626-090503.bak');
});

test('backupFileName: zero-padding — одноцифровые месяц/день/час/минута/секунда', () => {
  // 2024-01-05 09:04:07 UTC
  const d = new Date('2024-01-05T09:04:07Z');
  assert.equal(backupFileName('resume.md', d), 'resume.md.20240105-090407.bak');
});

test('backupFileName: zero-padding месяц < 10 и час < 10', () => {
  const d = new Date('2025-03-07T06:08:02Z');
  assert.equal(backupFileName('file.txt', d), 'file.txt.20250307-060802.bak');
});

test('backupFileName: baseName может содержать точки', () => {
  const d = new Date('2026-06-26T09:05:03Z');
  assert.equal(backupFileName('my.resume.md', d), 'my.resume.md.20260626-090503.bak');
});

test('backupFileName: throw TypeError на невалидном Date (new Date(«invalid»))', () => {
  assert.throws(
    () => backupFileName('resume.md', new Date('invalid')),
    TypeError,
  );
});

test('backupFileName: throw TypeError когда date не Date', () => {
  assert.throws(() => backupFileName('resume.md', null), TypeError);
  assert.throws(() => backupFileName('resume.md', '2026-06-26'), TypeError);
  assert.throws(() => backupFileName('resume.md', 1234567890), TypeError);
});

// ─── ГЛАВНЫЙ honesty-инвариант (явный тест) ───────────────────────────────────

test('ГЛАВНЫЙ honesty-инвариант: applyAdditiveSkills НИКОГДА не добавляет навык вне approvedSkills', () => {
  // Даже «полезные» навыки не могут попасть в addedSkills, если их нет в approvedSkills
  const resume = '# Резюме\n\nОпыт: Docker\n';
  const approved = ['Terraform'];
  const result = applyAdditiveSkills(resume, approved);

  for (const skill of result.addedSkills) {
    const inApproved = approved.some((a) => a.toLowerCase() === skill.toLowerCase());
    assert.ok(inApproved, `«${skill}» появился в addedSkills, но не был в approvedSkills — НАРУШЕНИЕ HONESTY`);
  }

  // Навыки вне approvedSkills не должны присутствовать в тексте (кроме уже бывших)
  const origHas = (s) => resume.toLowerCase().includes(s.toLowerCase());
  for (const skill of result.addedSkills) {
    assert.ok(!origHas(skill), `«${skill}» был в исходном резюме, не должен считаться добавленным`);
  }
});

test('honesty-инвариант: текст резюме с пустым approvedSkills не меняется ни на байт', () => {
  // Важно: даже trailing newline не должна добавляться
  const cases = [
    '',
    'Docker',
    '# Резюме\n\nОпыт: Docker\n',
    '## Навыки\n- Python\n',
  ];
  for (const resume of cases) {
    const result = applyAdditiveSkills(resume, []);
    assert.strictEqual(result.text, resume, `текст изменился при пустом approvedSkills: ${JSON.stringify(resume)}`);
  }
});

// --- регрессия: additive-only при многословном/конечном заголовке навыков ---

test('additive: многословный заголовок «## Ключевые навыки и технологии» не искажается', () => {
  const resume = '# Резюме\n\n## Ключевые навыки и технологии\n- Docker\n- Bash';
  const result = applyAdditiveSkills(resume, ['Terraform']);
  // строка заголовка сохранена целиком
  assert.ok(result.text.includes('## Ключевые навыки и технологии'));
  assert.ok(!result.text.includes('## Ключевые навыки \n'), 'заголовок не разрезан');
  // каждая исходная строка присутствует (additive-only)
  for (const line of resume.split('\n')) {
    assert.ok(result.text.split('\n').includes(line), `потеряна строка: ${JSON.stringify(line)}`);
  }
  assert.ok(result.text.includes('Terraform'));
});

test('additive: заголовок навыков в конце файла без хвостового \n не искажается', () => {
  const resume = '# Резюме\n\n## Навыки';
  const result = applyAdditiveSkills(resume, ['Terraform']);
  assert.ok(result.text.split('\n').includes('## Навыки'), 'строка заголовка сохранена целиком');
  assert.ok(!result.text.includes('## Навыки-'), 'нет склейки с навыком');
  assert.ok(result.text.includes('Terraform'));
});

test('additive: CRLF-резюме сохраняет CRLF, без смешанных переводов строк', () => {
  const resume = '# Резюме\r\n\r\n## Навыки\r\n- Docker\r\n';
  const result = applyAdditiveSkills(resume, ['Terraform']);
  assert.ok(result.text.includes('Terraform'));
  // нет одиночного LF, не входящего в CRLF (т.е. нет смешанных EOL)
  assert.ok(!/[^\r]\n/.test(result.text), 'обнаружен одиночный LF (смешанный EOL)');
  // additive-only: каждая исходная CRLF-строка присутствует
  for (const line of resume.split('\r\n')) {
    assert.ok(result.text.split('\r\n').includes(line), `потеряна строка: ${JSON.stringify(line)}`);
  }
});
