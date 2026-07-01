// Чистый парсер HTML чата chatik.hh.ru (список тредов + открытый тред).
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

// ---------------------------------------------------------------------------
// Парсер открытого треда (сообщения)
// ---------------------------------------------------------------------------

/**
 * Снимает HTML-теги со строки, заменяя блочные/переносные элементы на пробел.
 * Используется для извлечения чистого текста из bubble-разметки.
 *
 * @param {string} s
 * @returns {string}
 */
function stripTags(s) {
  // <br> и </p> → пробел (абзацный разделитель); все остальные теги — просто удаляем.
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]*>/g, '');
}

/**
 * Декодирует базовые HTML-сущности.
 * Поддерживаемые: &amp; &lt; &gt; &quot; &#39; &apos; &nbsp;
 *
 * @param {string} s
 * @returns {string}
 */
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Разбирает HTML открытого треда chatik и возвращает сообщения в хронологическом порядке.
 *
 * Алгоритм:
 * 1. Находим все контейнеры сообщений по data-qa="chatik-chat-message-<digits>" (строго цифры,
 *    без суффикса — исключаем -text и -applicant-action).
 * 2. Фрагментируем HTML по позициям контейнеров (как в parseThreadList).
 * 3. Внутри фрагмента определяем автора по наличию data-qa="chat-bubble-author-name":
 *    - присутствует → author='employer' (входящее)
 *    - отсутствует → author='applicant' (исходящее, наше)
 * 4. Извлекаем текст из data-qa="chat-bubble-text": снимаем теги, декодируем сущности,
 *    коллапсируем пробелы. Несколько <p> склеиваются через пробел (удобно для скоринга/генерации).
 *
 * @param {string} html — innerHTML или outerHTML контейнера сообщений.
 * @returns {Array<{ msgId: string, author: 'employer' | 'applicant', text: string }>}
 */
export function parseThreadMessages(html) {
  if (typeof html !== 'string' || html.length === 0) return [];

  const results = [];

  // Ищем контейнеры сообщений: data-qa="chatik-chat-message-<digits>"
  // Якорь — закрывающая кавычка сразу после цифр, без суффикса (-text, -applicant-action).
  // Паттерн: data-qa="chatik-chat-message-(\d+)" — цифры заканчиваются кавычкой.
  const containerPattern = /data-qa="chatik-chat-message-(\d+)"/g;
  const anchors = [];
  let m;

  while ((m = containerPattern.exec(html)) !== null) {
    anchors.push({ msgId: m[1], pos: m.index });
  }

  if (anchors.length === 0) return [];

  for (let i = 0; i < anchors.length; i += 1) {
    const { msgId, pos } = anchors[i];
    const sliceEnd = i + 1 < anchors.length ? anchors[i + 1].pos : html.length;
    const fragment = html.slice(pos, sliceEnd);

    // Определяем автора: входящее (employer) если есть author-name
    const author = fragment.includes('data-qa="chat-bubble-author-name"') ? 'employer' : 'applicant';

    // Извлекаем содержимое data-qa="chat-bubble-text" из фрагмента.
    // Стратегия: находим позицию атрибута, ищем закрытие открывающего тега (>),
    // затем берём всё содержимое до закрывающего тега того же элемента.
    // Фрагмент уже ограничен следующим контейнером сообщения — нет риска перепрыгнуть.
    let text = '';
    const bubbleAttrIdx = fragment.indexOf('data-qa="chat-bubble-text"');
    if (bubbleAttrIdx !== -1) {
      // Находим конец открывающего тега bubble (первый > после атрибута)
      const openTagEnd = fragment.indexOf('>', bubbleAttrIdx);
      if (openTagEnd !== -1) {
        // Определяем имя тега bubble (div или span — смотрим назад до <)
        const tagOpen = fragment.lastIndexOf('<', bubbleAttrIdx);
        const tagNameMatch = tagOpen !== -1
          ? fragment.slice(tagOpen + 1, bubbleAttrIdx).match(/^(\w+)/)
          : null;
        const tagName = tagNameMatch ? tagNameMatch[1] : 'div';

        // Берём содержимое после открывающего тега до закрывающего </tagName>.
        // Эвристика «первое </tagName>»: вложенность не балансируется. Для реальной
        // разметки bubble (div > span.markdown > p — вложены ДРУГИЕ теги) это корректно;
        // деградация лишь при вложенном ОДНОИМЁННОМ первом потомке (обрежется хвост) —
        // редко для текста сообщения и не критично (частичный текст, без падения).
        const innerHtml = fragment.slice(openTagEnd + 1);
        const closeTag = `</${tagName}>`;
        const closeIdx = innerHtml.indexOf(closeTag);
        const raw = closeIdx !== -1 ? innerHtml.slice(0, closeIdx) : innerHtml;
        // ВНИМАНИЕ (untrusted): decode идёт ПОСЛЕ strip, поэтому экранированная разметка
        // в письме работодателя (&lt;script&gt;) превращается в литеральные <script> в text.
        // Это untrusted prompt-injection-поверхность: текст — ДАННЫЕ, никогда не селектор/
        // путь/команда. Потребитель в M4.5 обязан сохранять авторитет системного промпта и
        // не передавать этот текст ничему, что интерпретирует разметку.
        text = decodeEntities(stripTags(raw)).replace(/\s+/g, ' ').trim();
      }
    }

    results.push({ msgId, author, text });
  }

  return results;
}

/**
 * Сливает несколько снимков списка тредов (из скролла виртуализированного списка) в один
 * дедуплицированный массив по chatId, сохраняя порядок первого появления. unread/unreadCount
 * агрегируются оптимистично (если тред где-то помечен непрочитанным — сохраняем это).
 *
 * @param {Array<{chatId: string, href: string, unread: boolean, unreadCount: number}>} acc — уже накопленное
 * @param {Array<{chatId: string, href: string, unread: boolean, unreadCount: number}>} next — новый снимок
 * @returns {Array<{chatId: string, href: string, unread: boolean, unreadCount: number}>}
 */
export function mergeThreadsById(acc, next) {
  const result = Array.isArray(acc) ? acc.slice() : [];
  if (!Array.isArray(next)) return result;

  const indexById = new Map();
  result.forEach((t, i) => {
    if (t && typeof t === 'object' && t.chatId) indexById.set(t.chatId, i);
  });

  for (const item of next) {
    if (!item || typeof item !== 'object' || !item.chatId) continue;

    const existingIdx = indexById.get(item.chatId);
    if (existingIdx === undefined) {
      result.push(item);
      indexById.set(item.chatId, result.length - 1);
      continue;
    }

    const existing = result[existingIdx];
    result[existingIdx] = {
      ...existing,
      unread: Boolean(existing.unread || item.unread),
      unreadCount: Math.max(existing.unreadCount || 0, item.unreadCount || 0),
    };
  }

  return result;
}

/**
 * Возвращает текст последнего сообщения с author==='employer' из массива сообщений.
 * Принимает уже разобранный массив (результат parseThreadMessages), а не сырой HTML —
 * это делает функцию чистой и переиспользуемой.
 *
 * @param {Array<{ msgId: string, author: string, text: string }>} messages
 * @returns {string} текст последнего входящего сообщения, или '' если входящих нет / аргумент некорректный.
 */
export function lastEmployerMessage(messages) {
  if (!Array.isArray(messages)) return '';
  let last = '';
  for (const msg of messages) {
    // Паритет с decideReply: пропускаем битые/не-объектные элементы (не роняем прогон).
    if (!msg || typeof msg !== 'object') continue;
    if (msg.author === 'employer') last = msg.text;
  }
  return last;
}
