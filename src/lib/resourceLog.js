// src/lib/resourceLog.js — логирование ресурсов процесса в logs/resources.jsonl (M11.4).
//
// Тонкая IO-обёртка над чистым sampleProcessResources (resourceSample.js): снимает мгновенный
// срез памяти/CPU и дозаписывает одну JSONL-строку в logs/resources.jsonl. Замыкание хранит
// prevCpu/prevTs для расчёта дельты CPU между вызовами (кумулятивные счётчики process.cpuUsage).
//
// Best-effort: любая ошибка IO или вычислений молча проглатывается — запись ресурсов НИКОГДА
// не должна ронять живой цикл демона. Возвращает null при сбое.
//
// БЕЗОПАСНОСТЬ: пишем только числа { ts, rssMb, heapMb, cpuPercent, openContexts } —
// ни ключа DeepSeek, ни PII, ни данных аккаунта в файл не уходит.

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { sampleProcessResources } from './resourceSample.js';
import { resourcesLogPath } from '../config.js';

/**
 * Фабрика логгера ресурсов. Создаётся один раз до цикла демона; замыкание держит prevCpu/prevTs.
 *
 * @param {object} [deps] — инъекция для тестов:
 *   { appendFile, mkdir, filePath, memoryUsage, cpuUsage, now }
 * @returns {Function} logResourceSample(extra?) — снимает срез и дозаписывает JSONL-строку.
 *   Возвращает Promise<object|null>: записанную строку или null при сбое (best-effort).
 */
export function createResourceLogger(deps = {}) {
  const append = deps.appendFile || appendFile;
  const mkDir = deps.mkdir || mkdir;
  const filePath = deps.filePath || resourcesLogPath;
  const readMemory = deps.memoryUsage || (() => process.memoryUsage());
  const readCpu = deps.cpuUsage || (() => process.cpuUsage());   // кумулятивные микросекунды
  const clock = deps.now || (() => Date.now());                  // эпоха мс

  let prevCpu = null;
  let prevTs = null;

  // logResourceSample({ openContexts }) — снапшот + дозапись одной JSONL-строки.
  // Best-effort: ошибка IO → возвращает null (запись ресурсов не критична).
  return async function logResourceSample(extra = {}) {
    try {
      const memoryUsage = readMemory();
      const cpuUsage = readCpu();
      const ts = clock();
      const elapsedMs = prevTs == null ? 0 : ts - prevTs;  // первый семпл → 0 → cpuPercent 0
      const sample = sampleProcessResources({ memoryUsage, cpuUsage, prevCpu, elapsedMs });
      prevCpu = cpuUsage;
      prevTs = ts;
      const oc = extra && typeof extra === 'object' ? extra.openContexts : undefined;
      const openContexts = Number.isFinite(oc) && oc >= 0 ? Math.floor(oc) : 0;
      const row = {
        ts: new Date(ts).toISOString(),
        rssMb: sample.rssMb,
        heapMb: sample.heapMb,
        cpuPercent: sample.cpuPercent,
        openContexts,
      };
      await mkDir(path.dirname(filePath), { recursive: true });
      await append(filePath, `${JSON.stringify(row)}\n`, 'utf8');
      return row;
    } catch {
      // Запись ресурсов — наблюдаемость, не корректность: не роняем цикл демона.
      return null;
    }
  };
}
