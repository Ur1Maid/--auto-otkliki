// Чистый хелпер для сжатия текста вакансии: оставляет только требования и обязанности.

const SECTION_MARKERS = [
  'Требования',
  'Обязанности',
  'Что мы ждём',
  'Что мы ждем',
  'Ожидания',
  'Будет плюсом',
  'Будет преимуществом',
  'Чем предстоит заниматься',
  'Требуемый опыт',
  'Ключевые навыки',
  'Мы ожидаем',
  'От вас',
  'Нам важно',
];

/**
 * Возвращает сжатую строку вакансии, начиная с первого найденного маркера раздела.
 * Если маркер не найден — возвращает первые maxLen символов.
 * Пустой/пробельный ввод → ''.
 */
export function extractRequirements(vacancyText, maxLen = 1500) {
  if (!vacancyText || !vacancyText.trim()) return '';

  let earliest = -1;

  for (const marker of SECTION_MARKERS) {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = vacancyText.search(new RegExp('(?<![а-яёa-z0-9])' + escaped, 'i'));
    if (match !== -1 && (earliest === -1 || match < earliest)) {
      earliest = match;
    }
  }

  const slice = earliest !== -1
    ? vacancyText.slice(earliest)
    : vacancyText;

  return slice.slice(0, maxLen).trim();
}
