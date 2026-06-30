// Чистый семплер ресурсов процесса для панели управления (M11.3).
// Детерминирован от входных аргументов: НЕ вызывает process.memoryUsage()/cpuUsage()/Date.now()
// сам — вызывающий (daemon.js) снимает реальные значения и инъектирует их сюда, тесты передают
// синтетические. IO (запись logs/resources.jsonl) и реальный process — на стороне вызывающего.
//
// БЕЗОПАСНОСТЬ: модуль оперирует только числами (байты/микросекунды) — ни ключа, ни PII.
//
// Использование (в живом демоне):
//   const mem = process.memoryUsage();
//   const cpu = process.cpuUsage();                  // кумулятивно, микросекунды
//   const sample = sampleProcessResources({ memoryUsage: mem, cpuUsage: cpu,
//                                           prevCpu, elapsedMs });
//   prevCpu = cpu;                                   // для следующего семпла
//   // fs.appendFile('logs/resources.jsonl', JSON.stringify({ ts, ...sample }) + '\n')

const BYTES_PER_MB = 1024 * 1024;

/** Округляет до одного знака после запятой. Не-конечное → 0. */
function round1(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}

/** Конечное число >= 0 → как есть, иначе 0 (защита от мусора/отрицательных). */
function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Байты → мегабайты (округление до 0.1 МБ). Невалидный/отрицательный вход → 0. */
function bytesToMb(bytes) {
  return round1(nonNegative(bytes) / BYTES_PER_MB);
}

/**
 * Считает % загрузки CPU за интервал из кумулятивных снимков cpuUsage.
 * Дельта user+system (микросекунды) делится на прошедшее настенное время.
 * На многоядерной машине результат может превышать 100% — это не клампится (намеренно).
 *
 * Возвращает 0, если данных недостаточно (нет prevCpu/cpuUsage или elapsedMs <= 0) —
 * первый семпл прогона честно показывает 0.
 *
 * @param {object} cpuUsage — текущий кумулятивный снимок { user, system } в микросекундах
 * @param {object} prevCpu  — предыдущий кумулятивный снимок { user, system } в микросекундах
 * @param {number} elapsedMs — настенное время между снимками (мс)
 * @returns {number} процент загрузки, округлённый до 0.1; >= 0
 */
function computeCpuPercent(cpuUsage, prevCpu, elapsedMs) {
  if (!cpuUsage || typeof cpuUsage !== 'object') return 0;
  if (!prevCpu || typeof prevCpu !== 'object') return 0;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;

  const deltaUser = nonNegative(cpuUsage.user) - nonNegative(prevCpu.user);
  const deltaSystem = nonNegative(cpuUsage.system) - nonNegative(prevCpu.system);
  const busyMicros = deltaUser + deltaSystem;
  // !(x > 0) гасит и неположительную дельту (сброс счётчика/перестановка снимков), и NaN.
  if (!(busyMicros > 0)) return 0;

  // busyMicros (мкс) / (elapsedMs * 1000 мкс) * 100% == busyMicros / (elapsedMs * 10)
  return round1(busyMicros / (elapsedMs * 10));
}

/**
 * Снимает срез ресурсов процесса из инъецированных значений.
 * Никогда не бросает: мусор/отсутствие полей → нули.
 *
 * @param {object} [opts]
 * @param {object} [opts.memoryUsage] — результат process.memoryUsage() { rss, heapUsed, ... } в байтах
 * @param {object} [opts.cpuUsage]    — текущий process.cpuUsage() { user, system } в микросекундах
 * @param {object} [opts.prevCpu]     — предыдущий снимок cpuUsage для расчёта дельты
 * @param {number} [opts.elapsedMs]   — настенное время между prevCpu и cpuUsage (мс)
 * @returns {{ rssMb: number, heapMb: number, cpuPercent: number }}
 */
export function sampleProcessResources(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const mem = o.memoryUsage && typeof o.memoryUsage === 'object' ? o.memoryUsage : {};

  return {
    rssMb: bytesToMb(mem.rss),
    heapMb: bytesToMb(mem.heapUsed),
    cpuPercent: computeCpuPercent(o.cpuUsage, o.prevCpu, o.elapsedMs),
  };
}

/**
 * Короткая русская строка из среза ресурсов (для лога/панели).
 * Никогда не бросает; нормализует мусор через sampleProcessResources-семантику.
 *
 * @param {{ rssMb?: number, heapMb?: number, cpuPercent?: number }} [sample]
 * @returns {string}
 */
export function formatResources(sample) {
  const s = sample && typeof sample === 'object' ? sample : {};
  const rssMb = round1(nonNegative(s.rssMb));
  const heapMb = round1(nonNegative(s.heapMb));
  const cpuPercent = round1(nonNegative(s.cpuPercent));
  return `RSS ${rssMb} МБ, heap ${heapMb} МБ, CPU ${cpuPercent}%`;
}
