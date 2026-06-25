// Чистые функции обратимой микро-правки текста для «очков активности» резюме на hh.ru (M5.2).
// Без IO, сети, сайд-эффектов — только строковые преобразования.
//
// Схема:
//   canonical(t)       = trimEnd(t)          ← «снимок-эталон»; маркер убран
//   applyMicroEdit(t)  = canonical(t) + MARKER ← версия с маркером (отличается от canonical)
//   revert(t)          = canonical(t)          ← снимает любой маркер; тождественен canonical
//
// Выбор маркера — одиночный перевод строки '\n':
//   • Семантически незначим: trailing newline — общепринятое соглашение, не отображается.
//   • Надёжно убирается: canonical использует String.trimEnd(), удаляющий любые хвостовые
//     пробелы/переводы строк, — стабильная, стандартная операция.
//   • Минимальный дифф: applyMicroEdit(t).length - canonical(t).length === 1 всегда.
//   • Полная обратимость: revert(applyMicroEdit(t)) === canonical(t) для любого t.

/** Маркер — один завершающий перевод строки. Экспортируется для прозрачности и тестов. */
export const MICRO_EDIT_MARKER = '\n';

/**
 * Возвращает канонический вид текста: хвостовые пробелы и переводы строк убраны.
 * Это «снимок-эталон» — версия без микро-маркера.
 *
 * Guard: не-строка → ''.
 *
 * @param {string} text
 * @returns {string}
 */
export function canonical(text) {
  if (typeof text !== 'string') return '';
  return text.trimEnd();
}

/**
 * Возвращает текст с применённым микро-маркером: canonical(text) + MICRO_EDIT_MARKER.
 * Результат детерминированно отличается от canonical(text) ровно на MARKER.length символов.
 *
 * Инварианты:
 *   applyMicroEdit(t) !== canonical(t)                              (правка реальна)
 *   applyMicroEdit(t).length - canonical(t).length === MARKER.length (дифф минимален)
 *   canonical(applyMicroEdit(t)) === canonical(t)                   (смысл сохранён)
 *
 * Guard: не-строка трактуется как '' (через canonical).
 *
 * @param {string} text
 * @returns {string}
 */
export function applyMicroEdit(text) {
  return canonical(text) + MICRO_EDIT_MARKER;
}

/**
 * Снимает микро-правку: возвращает canonical(text).
 * Тождественен canonical; вынесен отдельно для читаемости call-site.
 *
 * @param {string} text
 * @returns {string}
 */
export function revert(text) {
  return canonical(text);
}
