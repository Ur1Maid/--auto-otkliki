import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResumeSuggestions,
  summarizeSuggestions,
  DEFAULT_SKILLS_LIMIT,
  DEFAULT_MIN_FREQUENCY,
} from '../src/lib/resumeSuggestions.js';
import { normalizeText, extractResumeKeywords } from '../src/lib/knowledge.js';

// Вспомогательная функция: строит summary с topKeywords
function makeSummary(topKeywords, extra = {}) {
  return {
    vacanciesSeen: 200,
    relevantVacancies: 80,
    topKeywords,
    greenSignals: [],
    commonTitles: [],
    examples: [],
    ...extra,
  };
}

// --- honesty: дедуп против сырого текста резюме (H1/H2) ---

test('honesty H1: навык ВНЕ whitelist, но присутствующий в резюме → НЕ предлагается', () => {
  // Jenkins нет в RESUME_KEYWORDS, но он реально в тексте резюме.
  const summary = makeSummary([{ name: 'Jenkins', count: 9 }]);
  const resumeText = '5 лет работаю с Jenkins, строю пайплайны в Jenkins ежедневно.';
  const result = buildResumeSuggestions({ summary, resumeText });
  const suggested = result.skillSuggestions.map((s) => s.skill);
  assert.ok(!suggested.includes('Jenkins'), 'Jenkins не должен попасть в additive');
  assert.ok(result.alreadyPresent.some((s) => s.skill === 'Jenkins'));
});

test('honesty H2: whitelist-навык с хвостовой точкой («Helm.») → распознан как присутствующий', () => {
  const summary = makeSummary([{ name: 'Helm', count: 6 }]);
  const resumeText = 'Деплою через Helm.';
  const result = buildResumeSuggestions({ summary, resumeText });
  const suggested = result.skillSuggestions.map((s) => s.skill);
  assert.ok(!suggested.includes('Helm'), 'Helm с точкой не должен предлагаться');
  assert.ok(result.alreadyPresent.some((s) => s.skill === 'Helm'));
});

test('honesty: навык вне whitelist и ОТСУТСТВУЮЩИЙ в резюме → корректно предлагается', () => {
  const summary = makeSummary([{ name: 'Jenkins', count: 9 }]);
  const resumeText = 'Опыт: Docker, Kubernetes. (Jenkins не упоминается)';
  // "Jenkins" фигурирует в скобке выше — заменим на чистое резюме без него:
  const clean = 'Опыт: Docker, Kubernetes, Terraform.';
  const result = buildResumeSuggestions({ summary, resumeText: clean });
  assert.ok(result.skillSuggestions.some((s) => s.skill === 'Jenkins'));
});

test('honesty: подстрока не считается присутствием (Go ≠ Google)', () => {
  const summary = makeSummary([{ name: 'Go', count: 5 }]);
  const resumeText = 'Использую Google Cloud и golang-подобные инструменты.';
  const result = buildResumeSuggestions({ summary, resumeText });
  // "Go" как отдельное слово отсутствует → должен предлагаться
  assert.ok(result.skillSuggestions.some((s) => s.skill === 'Go'));
});

test('дедуп: при повторе нормализованного имени хранится МАКС частота (вход не отсортирован)', () => {
  const summary = makeSummary([
    { name: 'Jenkins', count: 3 },
    { name: 'jenkins', count: 8 }, // дубль с большей частотой, ниже по списку
  ]);
  const result = buildResumeSuggestions({ summary, resumeText: 'Docker, Terraform.' });
  const jenkins = result.skillSuggestions.filter((s) => normalizeText(s.skill) === 'jenkins');
  assert.equal(jenkins.length, 1, 'один дедуплицированный элемент');
  assert.equal(jenkins[0].frequency, 8, 'хранится максимальная частота');
});

test('M2: дробный count нормализуется (floor) в частоте и в justification', () => {
  const summary = makeSummary([{ name: 'Jenkins', count: 7.9 }]);
  const result = buildResumeSuggestions({ summary, resumeText: 'Docker.' });
  const item = result.skillSuggestions.find((s) => s.skill === 'Jenkins');
  assert.equal(item.frequency, 7);
  assert.ok(item.justification.includes('7 вакансиях'));
  assert.ok(!item.justification.includes('7.9'));
});

// --- экспортируемые константы ---

test('DEFAULT_SKILLS_LIMIT: число > 0', () => {
  assert.equal(typeof DEFAULT_SKILLS_LIMIT, 'number');
  assert.ok(DEFAULT_SKILLS_LIMIT > 0);
});

test('DEFAULT_MIN_FREQUENCY: число >= 1', () => {
  assert.equal(typeof DEFAULT_MIN_FREQUENCY, 'number');
  assert.ok(DEFAULT_MIN_FREQUENCY >= 1);
});

// --- базовый кейс ---

test('базовый: Terraform → skillSuggestions, Docker → alreadyPresent, Ansible (count 1) → отброшен', () => {
  const summary = makeSummary([
    { name: 'Terraform', count: 7 },
    { name: 'Docker', count: 5 },
    { name: 'Ansible', count: 1 },
  ]);
  const resumeText = 'Работаю с Docker в продакшне, настраиваю контейнеры.';

  const result = buildResumeSuggestions({ summary, resumeText });

  const suggestionSkills = result.skillSuggestions.map((s) => s.skill);
  const presentSkills = result.alreadyPresent.map((s) => s.skill);

  assert.ok(suggestionSkills.includes('Terraform'), 'Terraform должен быть в skillSuggestions');
  assert.ok(!suggestionSkills.includes('Docker'), 'Docker не должен быть в skillSuggestions');
  assert.ok(!suggestionSkills.includes('Ansible'), 'Ansible (count=1) должен быть отброшен');

  assert.ok(presentSkills.includes('Docker'), 'Docker должен быть в alreadyPresent');
  assert.ok(!presentSkills.includes('Terraform'), 'Terraform не должен быть в alreadyPresent');
  assert.ok(!presentSkills.includes('Ansible'), 'Ansible не должен быть в alreadyPresent');
});

// --- honesty-инварианты ---

test('honesty: каждый skillSuggestion несёт requiresRealExperience===true', () => {
  const summary = makeSummary([
    { name: 'Terraform', count: 7 },
    { name: 'Kubernetes', count: 5 },
    { name: 'Prometheus', count: 3 },
  ]);
  const result = buildResumeSuggestions({ summary, resumeText: '' });

  assert.ok(result.skillSuggestions.length > 0, 'должны быть кандидаты');
  for (const s of result.skillSuggestions) {
    assert.strictEqual(s.requiresRealExperience, true,
      `requiresRealExperience должен быть true для "${s.skill}"`);
  }
});

test('honesty: ни один navyk из skillSuggestions не присутствует в resumeText (additive)', () => {
  const resumeText = 'Опыт: Docker, Ansible, Prometheus — всё своё.';
  const summary = makeSummary([
    { name: 'Docker', count: 10 },
    { name: 'Ansible', count: 8 },
    { name: 'Prometheus', count: 6 },
    { name: 'Terraform', count: 5 },
    { name: 'Kubernetes', count: 4 },
  ]);
  const result = buildResumeSuggestions({ summary, resumeText });

  const present = new Set(extractResumeKeywords(resumeText).map(normalizeText));

  for (const s of result.skillSuggestions) {
    assert.ok(
      !present.has(normalizeText(s.skill)),
      `"${s.skill}" уже есть в резюме, не должен быть в skillSuggestions`,
    );
  }
});

test('honesty: justification содержит число частоты', () => {
  const summary = makeSummary([{ name: 'Terraform', count: 7 }]);
  const result = buildResumeSuggestions({ summary, resumeText: '' });

  assert.equal(result.skillSuggestions.length, 1);
  assert.ok(
    result.skillSuggestions[0].justification.includes('7'),
    'justification должен содержать частоту 7',
  );
});

test('honesty: justification содержит vacanciesSeen когда > 0', () => {
  const summary = makeSummary([{ name: 'Terraform', count: 7 }], { vacanciesSeen: 200 });
  const result = buildResumeSuggestions({ summary, resumeText: '' });
  assert.ok(result.skillSuggestions[0].justification.includes('200'));
});

test('honesty: justification без «из N просмотренных» когда vacanciesSeen = 0', () => {
  const summary = makeSummary([{ name: 'Terraform', count: 7 }], { vacanciesSeen: 0 });
  const result = buildResumeSuggestions({ summary, resumeText: '' });
  assert.ok(!result.skillSuggestions[0].justification.includes('просмотренных'));
});

// --- сортировка ---

test('сортировка: frequency DESC, тай-брейк name ASC', () => {
  const summary = makeSummary([
    { name: 'Terraform', count: 5 },
    { name: 'Kubernetes', count: 10 },
    { name: 'Ansible', count: 10 },
    { name: 'Prometheus', count: 3 },
  ]);
  const result = buildResumeSuggestions({ summary, resumeText: '' });
  const skills = result.skillSuggestions.map((s) => s.skill);

  // Kubernetes и Ansible оба count=10; Ansible < Kubernetes по алфавиту → Ansible первый
  assert.equal(skills[0], 'Ansible', 'при одинаковой частоте алфавитный порядок: Ansible перед Kubernetes');
  assert.equal(skills[1], 'Kubernetes');
  assert.equal(skills[2], 'Terraform');
  assert.equal(skills[3], 'Prometheus');
});

// --- skillsLimit ---

test('skillsLimit: обрезает skillSuggestions до указанного числа', () => {
  const keywords = [
    { name: 'Terraform', count: 10 },
    { name: 'Kubernetes', count: 9 },
    { name: 'Ansible', count: 8 },
    { name: 'Prometheus', count: 7 },
    { name: 'Grafana', count: 6 },
  ];
  const summary = makeSummary(keywords);
  const result = buildResumeSuggestions({ summary, resumeText: '', skillsLimit: 3 });

  assert.equal(result.skillSuggestions.length, 3, 'skillsLimit=3 должен обрезать до 3');
});

test('skillsLimit: некорректное значение → DEFAULT_SKILLS_LIMIT', () => {
  const keywords = Array.from({ length: 5 }, (_, i) => ({
    name: ['Terraform', 'Kubernetes', 'Ansible', 'Prometheus', 'Grafana'][i],
    count: 5 - i,
  }));
  const summary = makeSummary(keywords);

  // null → дефолт
  const result = buildResumeSuggestions({ summary, resumeText: '', skillsLimit: null });
  assert.ok(result.skillSuggestions.length <= DEFAULT_SKILLS_LIMIT);

  // 0 → дефолт
  const result2 = buildResumeSuggestions({ summary, resumeText: '', skillsLimit: 0 });
  assert.ok(result2.skillSuggestions.length <= DEFAULT_SKILLS_LIMIT);
});

// --- minFrequency кастомный ---

test('minFrequency: кастомный порог 5 исключает count<5', () => {
  const summary = makeSummary([
    { name: 'Terraform', count: 6 },
    { name: 'Kubernetes', count: 4 },
    { name: 'Ansible', count: 2 },
  ]);
  const result = buildResumeSuggestions({ summary, resumeText: '', minFrequency: 5 });
  const skills = result.skillSuggestions.map((s) => s.skill);

  assert.ok(skills.includes('Terraform'), 'count=6 >= minFrequency=5 → должен попасть');
  assert.ok(!skills.includes('Kubernetes'), 'count=4 < minFrequency=5 → должен быть отброшен');
  assert.ok(!skills.includes('Ansible'), 'count=2 < minFrequency=5 → должен быть отброшен');
});

test('minFrequency: некорректное значение → DEFAULT_MIN_FREQUENCY', () => {
  const summary = makeSummary([
    { name: 'Terraform', count: 1 }, // ниже DEFAULT_MIN_FREQUENCY=2
    { name: 'Kubernetes', count: 3 },
  ]);
  const result = buildResumeSuggestions({ summary, resumeText: '', minFrequency: -1 });
  const skills = result.skillSuggestions.map((s) => s.skill);

  // DEFAULT_MIN_FREQUENCY=2, count=1 должен быть отброшен
  assert.ok(!skills.includes('Terraform'), 'Terraform (count=1) должен быть отброшен при дефолтном minFrequency=2');
  assert.ok(skills.includes('Kubernetes'), 'Kubernetes (count=3) должен попасть');
});

// --- дедуп по normalized name ---

test('дедуп: дублирующиеся навыки с одинаковым нормализованным именем учитываются один раз', () => {
  // 'Terraform' и 'terraform' нормализуются одинаково
  const summary = makeSummary([
    { name: 'Terraform', count: 7 },
    { name: 'terraform', count: 5 },
  ]);
  const result = buildResumeSuggestions({ summary, resumeText: '' });

  // Должен остаться только первый (с count=7, именно 'Terraform')
  const terraformEntries = result.skillSuggestions.filter(
    (s) => normalizeText(s.skill) === 'terraform',
  );
  assert.equal(terraformEntries.length, 1, 'дедуп: только один элемент для Terraform');
  assert.equal(terraformEntries[0].frequency, 7, 'остаётся первый (наибольший count после сортировки)');
});

test('дедуп в alreadyPresent: нормализованные дубли не повторяются', () => {
  const summary = makeSummary([
    { name: 'Docker', count: 8 },
    { name: 'docker', count: 4 },
  ]);
  const resumeText = 'Работаю с Docker ежедневно.';
  const result = buildResumeSuggestions({ summary, resumeText });

  const dockerEntries = result.alreadyPresent.filter(
    (s) => normalizeText(s.skill) === 'docker',
  );
  assert.equal(dockerEntries.length, 1, 'дедуп alreadyPresent: только один Docker');
});

// --- пустой/мусорный summary ---

test('пустой summary → пустые массивы, без throw', () => {
  assert.doesNotThrow(() => {
    const result = buildResumeSuggestions({ summary: null, resumeText: '' });
    assert.deepEqual(result.skillSuggestions, []);
    assert.deepEqual(result.alreadyPresent, []);
    assert.equal(result.vacanciesSeen, 0);
    assert.equal(result.relevantVacancies, 0);
  });
});

test('summary=undefined → пустые массивы, без throw', () => {
  assert.doesNotThrow(() => {
    const result = buildResumeSuggestions({ summary: undefined, resumeText: '' });
    assert.deepEqual(result.skillSuggestions, []);
  });
});

test('summary=строка → пустые массивы, без throw', () => {
  assert.doesNotThrow(() => {
    const result = buildResumeSuggestions({ summary: 'garbage', resumeText: '' });
    assert.deepEqual(result.skillSuggestions, []);
  });
});

test('topKeywords=undefined → пустые массивы, без throw', () => {
  assert.doesNotThrow(() => {
    const result = buildResumeSuggestions({
      summary: { vacanciesSeen: 10, relevantVacancies: 5, topKeywords: undefined },
      resumeText: '',
    });
    assert.deepEqual(result.skillSuggestions, []);
  });
});

// --- resumeText не строка ---

test('resumeText=null → не падает, ведёт себя как пустое резюме', () => {
  const summary = makeSummary([{ name: 'Terraform', count: 5 }]);
  assert.doesNotThrow(() => {
    const result = buildResumeSuggestions({ summary, resumeText: null });
    assert.equal(result.skillSuggestions.length, 1);
  });
});

test('resumeText=число → не падает', () => {
  const summary = makeSummary([{ name: 'Kubernetes', count: 4 }]);
  assert.doesNotThrow(() => {
    buildResumeSuggestions({ summary, resumeText: 42 });
  });
});

// --- битые элементы в topKeywords ---

test('битые элементы в topKeywords: null, name=null, count=NaN — пропускаются', () => {
  const summary = makeSummary([
    null,
    { name: null, count: 5 },
    { name: 'Terraform', count: NaN },
    { name: '', count: 5 },
    { name: 'Kubernetes', count: 4 },   // единственный валидный
  ]);
  assert.doesNotThrow(() => {
    const result = buildResumeSuggestions({ summary, resumeText: '' });
    assert.equal(result.skillSuggestions.length, 1);
    assert.equal(result.skillSuggestions[0].skill, 'Kubernetes');
  });
});

test('битые элементы: count=0 → пропускается', () => {
  const summary = makeSummary([
    { name: 'Terraform', count: 0 },
    { name: 'Kubernetes', count: 3 },
  ]);
  const result = buildResumeSuggestions({ summary, resumeText: '' });
  const skills = result.skillSuggestions.map((s) => s.skill);
  assert.ok(!skills.includes('Terraform'), 'count=0 должен быть пропущен');
  assert.ok(skills.includes('Kubernetes'));
});

// --- alreadyPresent: не обрезается skillsLimit ---

test('alreadyPresent: не обрезается skillsLimit, содержит все совпавшие навыки >= minFrequency', () => {
  // Создаём резюме со всеми навыками + большой список
  const keywords = [
    { name: 'Docker', count: 10 },
    { name: 'Kubernetes', count: 9 },
    { name: 'Ansible', count: 8 },
    { name: 'Terraform', count: 7 },
    { name: 'Prometheus', count: 6 },
  ];
  // Все 5 навыков есть в резюме — используем слова строго из RESUME_KEYWORDS
  const resumeText = 'Работаю с Docker, Kubernetes, Ansible, Terraform, Prometheus ежедневно.';
  const summary = makeSummary(keywords);

  const result = buildResumeSuggestions({ summary, resumeText, skillsLimit: 2 });

  // Все навыки из keywords должны быть в alreadyPresent (все они есть в resumeText)
  const presentSkills = result.alreadyPresent.map((s) => normalizeText(s.skill));
  assert.ok(presentSkills.includes('docker'), 'Docker должен быть в alreadyPresent');
  assert.ok(presentSkills.includes('kubernetes'), 'Kubernetes должен быть в alreadyPresent');
  assert.ok(presentSkills.includes('ansible'), 'Ansible должен быть в alreadyPresent');
  assert.ok(presentSkills.includes('terraform'), 'Terraform должен быть в alreadyPresent');
  assert.ok(presentSkills.includes('prometheus'), 'Prometheus должен быть в alreadyPresent');
  // skillSuggestions пустой — ни одного нового навыка
  assert.equal(result.skillSuggestions.length, 0, 'все навыки уже в резюме — skillSuggestions пустой');
  // alreadyPresent не обрезается skillsLimit=2 — должны быть все 5
  assert.equal(result.alreadyPresent.length, 5, 'alreadyPresent не обрезается skillsLimit');
});

// --- vacanciesSeen / relevantVacancies ---

test('vacanciesSeen и relevantVacancies передаются из summary', () => {
  const summary = makeSummary([], { vacanciesSeen: 150, relevantVacancies: 42 });
  const result = buildResumeSuggestions({ summary, resumeText: '' });
  assert.equal(result.vacanciesSeen, 150);
  assert.equal(result.relevantVacancies, 42);
});

test('некорректные vacanciesSeen/relevantVacancies → 0', () => {
  const summary = makeSummary([], { vacanciesSeen: 'много', relevantVacancies: null });
  const result = buildResumeSuggestions({ summary, resumeText: '' });
  assert.equal(result.vacanciesSeen, 0);
  assert.equal(result.relevantVacancies, 0);
});

// --- summarizeSuggestions ---

test('summarizeSuggestions: корректная строка для нормального результата', () => {
  const summary = makeSummary([
    { name: 'Terraform', count: 7 },
    { name: 'Docker', count: 5 },
  ]);
  const resumeText = 'Знаю Docker.';
  const suggestions = buildResumeSuggestions({ summary, resumeText });
  const str = summarizeSuggestions(suggestions);

  assert.ok(typeof str === 'string' && str.length > 0, 'должна вернуть непустую строку');
  assert.ok(str.includes('Кандидатов на добавление:'), 'содержит заголовок');
  assert.ok(str.includes('уже в резюме:'), 'содержит секцию "уже в резюме"');
  assert.ok(str.includes('200'), 'содержит vacanciesSeen=200');
});

test('summarizeSuggestions: мусор → "Нет предложений."', () => {
  assert.equal(summarizeSuggestions(null), 'Нет предложений.');
  assert.equal(summarizeSuggestions(undefined), 'Нет предложений.');
  assert.equal(summarizeSuggestions('строка'), 'Нет предложений.');
  assert.equal(summarizeSuggestions(42), 'Нет предложений.');
});

test('summarizeSuggestions: пустые массивы — нули в строке', () => {
  const str = summarizeSuggestions({ skillSuggestions: [], alreadyPresent: [], vacanciesSeen: 0 });
  assert.ok(str.includes('0'), 'должны быть нули');
  assert.ok(!str.includes('undefined'));
});

// --- вызов без аргументов ---

test('buildResumeSuggestions без аргументов → не падает, возвращает пустые массивы', () => {
  assert.doesNotThrow(() => {
    const result = buildResumeSuggestions();
    assert.deepEqual(result.skillSuggestions, []);
    assert.deepEqual(result.alreadyPresent, []);
  });
});
