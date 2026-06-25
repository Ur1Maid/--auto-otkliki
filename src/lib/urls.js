// Чистые URL-хелперы для нормализации ссылок hh.ru.

export function normalizeHhUrl(url) {
  const parsed = new URL(url, 'https://hh.ru');
  parsed.hash = '';
  return parsed.toString();
}

export function normalizeVacancyUrl(url) {
  const parsed = new URL(url, 'https://hh.ru');
  const match = parsed.pathname.match(/^\/vacancy\/\d+/);
  if (!match) return '';
  parsed.pathname = match[0];
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}
