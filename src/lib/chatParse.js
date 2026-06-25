// Чистый парсер HTML-списка тредов chatik.hh.ru.
// Без сайд-эффектов, без Playwright, без сетевых вызовов.
// Парсинг через регэкспы, заякоренные на стабильные data-qa (не на хешированные классы).

/**
 * Разбирает HTML-строку списка тредов chatik и возвращает массив объектов тредов.
 *
 * Алгоритм:
 * 1. Находим все вхождения data-qa="chatik-open-chat-<id>" и их позиции в строке.
 * 2. Для каждого вхождения вырезаем «фрагмент ячейки» — от текущей позиции до закрывающего
 *    </a> (в пределах до начала следующего chatik-open-chat-*). Это изолирует HTML одного треда
 *    и не даёт хвостовой разметке приписать бейдж не тому треду.
 * 3. Внутри фрагмента ищем href ячейки и data-qa="chatik-info-badges" (бейдж непрочитанных).
 *
 * @param {string} html — сырой innerHTML или outerHTML контейнера списка тредов.
 * @returns {Array<{ chatId: string, href: string, unread: boolean, unreadCount: number }>}
 */
export function parseThreadList(html) {
  if (typeof html !== 'string' || html.length === 0) return [];

  const results = [];

  // Находим все ячейки по data-qa="chatik-open-chat-<digits>"
  // Захватываем позицию начала каждого тега <a>, chatId и href в том же теге.
  // Регэксп ищет открывающий тег <a ... data-qa="chatik-open-chat-<id>" ... href="...">
  // Атрибуты могут идти в любом порядке, поэтому ищем href и data-qa отдельно внутри тега.
  const tagPattern = /<a\b([^>]*?data-qa="chatik-open-chat-(\d+)"[^>]*?)>/gi;
  const matches = [];
  let tagMatch;

  while ((tagMatch = tagPattern.exec(html)) !== null) {
    const attrs = tagMatch[1];
    const chatId = tagMatch[2];
    // Позиция начала полного тега <a ...>
    const tagStart = tagMatch.index;

    // Извлекаем href из атрибутной строки тега
    const hrefMatch = attrs.match(/href="([^"]*)"/);
    const href = hrefMatch ? hrefMatch[1] : '';

    matches.push({ chatId, href, tagStart });
  }

  for (let i = 0; i < matches.length; i += 1) {
    const { chatId, href, tagStart } = matches[i];
    // Фрагмент ячейки: от текущей позиции до начала следующей ячейки (или конца строки).
    const sliceEnd = i + 1 < matches.length ? matches[i + 1].tagStart : html.length;
    let fragment = html.slice(tagStart, sliceEnd);
    // Ограничиваем фрагмент закрывающим тегом ячейки </a>, чтобы хвостовая разметка
    // (скелетоны/футер после последней ячейки) не приписала бейдж не тому треду. Бейдж
    // chatik-info-badges находится внутри <a>, поэтому до </a> он сохраняется.
    const closeIdx = fragment.indexOf('</a>');
    if (closeIdx !== -1) fragment = fragment.slice(0, closeIdx);

    // Ищем бейдж непрочитанных внутри фрагмента. Число может идти не сразу после тега
    // (пробелы/перенос строки или вложенный <span>), поэтому ищем первую цифру в
    // ограниченном окне после открытия бейджа (без риска catastrophic backtracking).
    const badgeMatch = fragment.match(/data-qa="chatik-info-badges"[^>]*>[\s\S]{0,80}?(\d+)/);
    let unread = false;
    let unreadCount = 0;

    if (badgeMatch) {
      unread = true;
      const parsed = parseInt(badgeMatch[1], 10);
      // Если число распарсилось — используем его; иначе unreadCount=0, но unread=true
      unreadCount = Number.isFinite(parsed) ? parsed : 0;
    } else if (fragment.includes('data-qa="chatik-info-badges"')) {
      // Бейдж есть, но число не извлечено — факт непрочитанного сохраняем
      unread = true;
      unreadCount = 0;
    }

    results.push({ chatId, href, unread, unreadCount });
  }

  return results;
}
