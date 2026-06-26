import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeTailoredResume } from '../src/lib/resumeWriter.js';

// Фиксированная дата для детерминированных имён бэкапов (UTC 2026-06-26 09:05:03)
const FIXED_DATE = new Date('2026-06-26T09:05:03Z');
const EXPECTED_BAK_SUFFIX = '.20260626-090503.bak';

// Реалистичное резюме без раздела навыков (достаточно строк, чтобы DEFAULT_MIN_SIMILARITY
// выдержал добавление 2–3 строк навыков).
const RESUME_NO_SKILLS = [
  '# Иванов Иван Иванович',
  'Email: ivan@example.com | Телефон: +7 999 000-00-00',
  '',
  '## Опыт работы',
  '',
  '**2022–2025** — Старший разработчик, ООО «Ромашка»',
  '- Разработка микросервисов на Node.js и TypeScript',
  '- Администрирование PostgreSQL и Redis',
  '- Настройка Docker-окружений и CI/CD пайплайнов',
  '- REST API, GraphQL, WebSocket',
  '',
  '**2019–2022** — Разработчик, ООО «Пример»',
  '- Backend на Python/Django',
  '- Работа с MySQL и MongoDB',
  '- Linux, Bash, Git',
  '',
  '## Образование',
  '**2015–2019** МГУ, Факультет ВМК',
  'Специальность: Математика и компьютерные науки',
  '',
  '## Личные качества',
  'Ответственность, внимание к деталям, умение работать в команде',
].join('\n');

// Резюме с заголовком «## Навыки» — тоже достаточно длинное
const RESUME_WITH_SKILLS_HEADING = [
  '# Петров Пётр Петрович',
  'Email: petrov@example.com',
  '',
  '## Навыки',
  '- Python, Django, FastAPI',
  '',
  '## Опыт работы',
  '',
  '**2021–2025** — Backend-разработчик, ООО «Технологии»',
  '- Разработка REST API на Python',
  '- Работа с PostgreSQL, Redis',
  '- Docker, Linux, Git',
  '',
  '**2018–2021** — Junior разработчик, ООО «Старт»',
  '- Разработка на PHP и MySQL',
  '- HTML, CSS, JavaScript',
  '',
  '## Образование',
  '**2014–2018** СПбГУ, Факультет математики',
].join('\n');

// Одобренные навыки, которых точно нет в RESUME_NO_SKILLS
const NEW_SKILLS = ['Kubernetes', 'Terraform'];

// Навыки, которые уже присутствуют в RESUME_NO_SKILLS
const PRESENT_SKILLS = ['Node.js', 'Docker'];

// ─── invalid_path ─────────────────────────────────────────────────────────────

test('invalid_path: пустая строка → written:false, writeFile не вызывается', async () => {
  const writes = [];
  const deps = {
    readFile: async () => { throw new Error('не должен вызываться'); },
    writeFile: async (p, c) => { writes.push({ path: p, content: c }); },
  };
  const result = await writeTailoredResume({ resumePath: '' }, deps);
  assert.equal(result.written, false);
  assert.equal(result.reason, 'invalid_path');
  assert.equal(writes.length, 0, 'writeFile не должен вызываться при invalid_path');
});

test('invalid_path: не строка (число) → written:false, writeFile не вызывается', async () => {
  const writes = [];
  const deps = {
    readFile: async () => { throw new Error('не должен вызываться'); },
    writeFile: async (p, c) => { writes.push({ path: p, content: c }); },
  };
  const result = await writeTailoredResume({ resumePath: 42 }, deps);
  assert.equal(result.written, false);
  assert.equal(result.reason, 'invalid_path');
  assert.equal(writes.length, 0);
});

test('invalid_path: null params → written:false reason invalid_path', async () => {
  const writes = [];
  const deps = {
    writeFile: async (p, c) => { writes.push({ path: p, content: c }); },
  };
  const result = await writeTailoredResume(null, deps);
  assert.equal(result.written, false);
  assert.equal(result.reason, 'invalid_path');
  assert.equal(writes.length, 0);
});

// ─── read_failed ──────────────────────────────────────────────────────────────

test('read_failed: readFile бросает → written:false reason read_failed, writeFile не вызывается', async () => {
  const writes = [];
  const deps = {
    readFile: async () => { throw new Error('ENOENT'); },
    writeFile: async (p, c) => { writes.push({ path: p, content: c }); },
  };
  const result = await writeTailoredResume(
    { resumePath: '/some/resume.md', approvedSkills: NEW_SKILLS },
    deps,
  );
  assert.equal(result.written, false);
  assert.equal(result.reason, 'read_failed');
  assert.equal(writes.length, 0, 'writeFile не должен вызываться при read_failed');
});

// ─── dry_run (дефолт) ─────────────────────────────────────────────────────────

test('dry_run дефолт: dryRun не передан → файл не записан, reason dry_run, preview содержит навык', async () => {
  const writes = [];
  const deps = {
    readFile: async () => RESUME_NO_SKILLS,
    writeFile: async (p, c) => { writes.push({ path: p, content: c }); },
  };
  // dryRun НЕ передаётся — должен сработать дефолт true
  const result = await writeTailoredResume(
    { resumePath: '/acc/resume.md', approvedSkills: NEW_SKILLS, date: FIXED_DATE },
    deps,
  );
  assert.equal(result.written, false, 'written должен быть false при dry_run');
  assert.equal(result.reason, 'dry_run');
  assert.ok(Array.isArray(result.wouldAddSkills) && result.wouldAddSkills.length > 0,
    'wouldAddSkills должен быть непустым');
  // Критичный safety-тест: writeFile НЕ должен вызываться
  assert.equal(writes.length, 0, 'SAFETY: writeFile НЕ должен вызываться в dry_run!');
  // preview должен содержать добавленный навык
  assert.ok(typeof result.preview === 'string' && result.preview.includes('Kubernetes'),
    'preview должен содержать добавленный навык Kubernetes');
});

test('dry_run явный true: аналогично дефолту, writeFile не вызывается', async () => {
  const writes = [];
  const deps = {
    readFile: async () => RESUME_NO_SKILLS,
    writeFile: async (p, c) => { writes.push({ path: p, content: c }); },
  };
  const result = await writeTailoredResume(
    { resumePath: '/acc/resume.md', approvedSkills: NEW_SKILLS, dryRun: true, date: FIXED_DATE },
    deps,
  );
  assert.equal(result.written, false);
  assert.equal(result.reason, 'dry_run');
  assert.equal(writes.length, 0, 'writeFile не должен вызываться при явном dryRun:true');
});

// ─── no_changes ───────────────────────────────────────────────────────────────

test('no_changes: approvedSkills пуст → written:false reason no_changes, writeFile не вызывается', async () => {
  const writes = [];
  const deps = {
    readFile: async () => RESUME_NO_SKILLS,
    writeFile: async (p, c) => { writes.push({ path: p, content: c }); },
  };
  const result = await writeTailoredResume(
    { resumePath: '/acc/resume.md', approvedSkills: [], dryRun: false, date: FIXED_DATE },
    deps,
  );
  assert.equal(result.written, false);
  assert.equal(result.reason, 'no_changes');
  assert.equal(writes.length, 0, 'writeFile не должен вызываться при no_changes');
});

test('no_changes: все approvedSkills уже в резюме → written:false reason no_changes', async () => {
  const writes = [];
  const deps = {
    readFile: async () => RESUME_NO_SKILLS,
    writeFile: async (p, c) => { writes.push({ path: p, content: c }); },
  };
  const result = await writeTailoredResume(
    { resumePath: '/acc/resume.md', approvedSkills: PRESENT_SKILLS, dryRun: false, date: FIXED_DATE },
    deps,
  );
  assert.equal(result.written, false);
  assert.equal(result.reason, 'no_changes');
  assert.equal(writes.length, 0, 'writeFile не должен вызываться при no_changes');
});

// ─── divergence exceeded ──────────────────────────────────────────────────────

test('divergence exceeded: maxChangedLines:0 → applied:false, written:false, writeFile не вызывается', async () => {
  const writes = [];
  const deps = {
    readFile: async () => RESUME_NO_SKILLS,
    writeFile: async (p, c) => { writes.push({ path: p, content: c }); },
  };
  // maxChangedLines:0 — любое добавление превысит лимит
  const result = await writeTailoredResume(
    {
      resumePath: '/acc/resume.md',
      approvedSkills: NEW_SKILLS,
      limits: { maxChangedLines: 0 },
      dryRun: false,
      date: FIXED_DATE,
    },
    deps,
  );
  assert.equal(result.written, false);
  // tailorResume вернёт reason:'divergence_limit_exceeded' → not_applied или divergence_limit_exceeded
  assert.ok(
    result.reason === 'divergence_limit_exceeded' || result.reason === 'not_applied',
    `неожиданный reason: ${result.reason}`,
  );
  assert.equal(writes.length, 0, 'writeFile не должен вызываться при превышении лимита дивергенции');
});

// ─── успешная запись ──────────────────────────────────────────────────────────

test('успешная запись: порядок, backupPath суффикс, backup-контент === оригинал, resume содержит навык', async () => {
  const writes = [];
  const deps = {
    readFile: async () => RESUME_NO_SKILLS,
    writeFile: async (p, c) => { writes.push({ path: p, content: c }); },
  };
  const result = await writeTailoredResume(
    {
      resumePath: '/home/user/resume.md',
      approvedSkills: NEW_SKILLS,
      dryRun: false,
      date: FIXED_DATE,
    },
    deps,
  );

  assert.equal(result.written, true, 'written должен быть true');
  assert.ok(Array.isArray(result.addedSkills) && result.addedSkills.length > 0,
    'addedSkills должен быть непустым');

  // Порядок: сначала бэкап, потом резюме
  assert.equal(writes.length, 2, 'должно быть ровно 2 вызова writeFile');
  const [backupWrite, resumeWrite] = writes;

  // backupPath имеет правильный суффикс
  assert.ok(backupWrite.path.endsWith(EXPECTED_BAK_SUFFIX),
    `backupPath должен оканчиваться на ${EXPECTED_BAK_SUFFIX}, получено: ${backupWrite.path}`);
  assert.equal(result.backupPath, backupWrite.path, 'backupPath в результате совпадает с реальным путём');

  // backup-контент === оригинал
  assert.equal(backupWrite.content, RESUME_NO_SKILLS, 'backup-контент должен совпадать с оригиналом');

  // resume-контент содержит добавленный навык
  assert.equal(resumeWrite.path, '/home/user/resume.md', 'второй вызов writeFile — для resume.md');
  assert.ok(resumeWrite.content.includes('Kubernetes'),
    'новое резюме должно содержать добавленный навык Kubernetes');

  // Оригинальное содержимое не потерялось
  assert.ok(resumeWrite.content.includes('Node.js'),
    'новое резюме должно сохранять исходные строки');

  // divergence присутствует
  assert.ok(result.divergence && typeof result.divergence === 'object', 'divergence должен быть объектом');
});

test('успешная запись с заголовком навыков: навык добавляется после заголовка', async () => {
  const writes = [];
  const deps = {
    readFile: async () => RESUME_WITH_SKILLS_HEADING,
    writeFile: async (p, c) => { writes.push({ path: p, content: c }); },
  };
  const result = await writeTailoredResume(
    {
      resumePath: '/home/user/resume.md',
      approvedSkills: ['Terraform'],
      dryRun: false,
      date: FIXED_DATE,
    },
    deps,
  );
  assert.equal(result.written, true);
  assert.ok(writes[1].content.includes('Terraform'), 'должен содержать Terraform');
  // Исходные навыки сохранены
  assert.ok(writes[1].content.includes('Python'), 'исходные навыки сохранены');
});

// ─── backup_failed ────────────────────────────────────────────────────────────

test('backup_failed: writeFile для backupPath бросает → written:false reason backup_failed, resume не перезаписан', async () => {
  const writes = [];
  let callCount = 0;
  const deps = {
    readFile: async () => RESUME_NO_SKILLS,
    writeFile: async (p, c) => {
      callCount++;
      if (callCount === 1) {
        // первый вызов — бэкап → бросаем ошибку
        throw new Error('EACCES: нет доступа');
      }
      writes.push({ path: p, content: c });
    },
  };
  const result = await writeTailoredResume(
    {
      resumePath: '/acc/resume.md',
      approvedSkills: NEW_SKILLS,
      dryRun: false,
      date: FIXED_DATE,
    },
    deps,
  );
  assert.equal(result.written, false);
  assert.equal(result.reason, 'backup_failed');
  // resume.md НЕ перезаписан (второй writeFile не вызывался)
  assert.equal(writes.length, 0, 'resume.md не должен перезаписываться при backup_failed');
});

// ─── write_failed ─────────────────────────────────────────────────────────────

test('write_failed: backup ок, writeFile для resume бросает → written:false reason write_failed, backupPath возвращён', async () => {
  let callCount = 0;
  const deps = {
    readFile: async () => RESUME_NO_SKILLS,
    writeFile: async (_p) => {
      callCount++;
      if (callCount === 2) {
        // второй вызов — запись resume.md → бросаем ошибку
        throw new Error('ENOSPC: нет места на диске');
      }
      // первый вызов — бэкап — проходит
    },
  };
  const result = await writeTailoredResume(
    {
      resumePath: '/acc/resume.md',
      approvedSkills: NEW_SKILLS,
      dryRun: false,
      date: FIXED_DATE,
    },
    deps,
  );
  assert.equal(result.written, false);
  assert.equal(result.reason, 'write_failed');
  // backupPath возвращён для ручного отката
  assert.ok(typeof result.backupPath === 'string' && result.backupPath.endsWith(EXPECTED_BAK_SUFFIX),
    `backupPath должен возвращаться при write_failed, получено: ${result.backupPath}`);
  assert.equal(callCount, 2, 'ровно 2 вызова writeFile: 1 — бэкап, 2 — неудачная запись resume');
});

// ─── honesty: addedSkills ⊆ approvedSkills ───────────────────────────────────

test('honesty: addedSkills ⊆ approvedSkills — ничего не выдумано', async () => {
  const writes = [];
  const deps = {
    readFile: async () => RESUME_NO_SKILLS,
    writeFile: async (p, c) => { writes.push({ path: p, content: c }); },
  };
  const approved = ['Kubernetes', 'Terraform', 'Helm'];
  const result = await writeTailoredResume(
    {
      resumePath: '/acc/resume.md',
      approvedSkills: approved,
      dryRun: false,
      date: FIXED_DATE,
    },
    deps,
  );
  assert.equal(result.written, true);
  const approvedSet = new Set(approved);
  for (const skill of result.addedSkills) {
    assert.ok(approvedSet.has(skill),
      `навык «${skill}» не был в approvedSkills — нарушение honesty!`);
  }
});

test('honesty dry_run: wouldAddSkills ⊆ approvedSkills', async () => {
  const deps = {
    readFile: async () => RESUME_NO_SKILLS,
    writeFile: async () => { assert.fail('writeFile не должен вызываться в dry_run'); },
  };
  const approved = ['Kubernetes', 'Ansible'];
  const result = await writeTailoredResume(
    { resumePath: '/acc/resume.md', approvedSkills: approved, date: FIXED_DATE },
    deps,
  );
  assert.equal(result.reason, 'dry_run');
  const approvedSet = new Set(approved);
  for (const skill of result.wouldAddSkills) {
    assert.ok(approvedSet.has(skill),
      `навык «${skill}» не был в approvedSkills — нарушение honesty!`);
  }
});

test('date невалидный (Invalid Date) → не бросает, использует текущее время', async () => {
  const writes = [];
  const original = [
    '# Резюме', '', '## Опыт',
    '- Инженер (2019–2025)', '- Docker, Kubernetes, Bash',
    '- PostgreSQL, Redis, Nginx', '- Prometheus, Grafana, Loki',
    '- CI/CD, GitLab, Ansible', '- Linux, systemd, cron',
    '- Vault, Harbor, S3', '- ELK, Elasticsearch, Kibana',
    '- TLS, SSL, cert-manager', '## Навыки', '- DevOps', '',
    '## Образование', 'МГУ, ВМК, 2019', '', 'Доп. строка 1',
    'Доп. строка 2', 'Доп. строка 3', 'Доп. строка 4',
  ].join('\n');
  const deps = {
    readFile: async () => original,
    writeFile: async (p, c) => { writes.push({ path: p, content: c }); },
  };
  const result = await writeTailoredResume(
    { resumePath: 'config/accounts/x/resume.md', approvedSkills: ['Terraform'], dryRun: false, date: new Date('мусор') },
    deps,
  );
  assert.equal(result.written, true);
  assert.ok(/\.\d{8}-\d{6}\.bak$/.test(result.backupPath), 'имя бэкапа сформировано из текущего времени');
});
