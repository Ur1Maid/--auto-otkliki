#!/usr/bin/env bash
# Ralph — автономный цикл Claude Code для hh-auto-otkliki (POSIX-вариант ralph.ps1).
# Использование:
#   ralph/ralph.sh [-n MAX_ITERATIONS] [-m MODEL] [--yolo]
set -euo pipefail

MAX=30
MODEL="claude-opus-4-8"
YOLO=0

while [ $# -gt 0 ]; do
  case "$1" in
    -n) MAX="$2"; shift 2 ;;
    -m) MODEL="$2"; shift 2 ;;
    --yolo) YOLO=1; shift ;;
    *) echo "Неизвестный аргумент: $1" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."
mkdir -p ralph/logs

command -v claude >/dev/null 2>&1 || { echo "CLI 'claude' не найден в PATH." >&2; exit 1; }

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "ralph/auto" ]; then
  echo "[ralph] Ветка '$branch' -> переключаюсь на 'ralph/auto'."
  git checkout ralph/auto 2>/dev/null || git checkout -b ralph/auto
fi

if [ "$YOLO" -eq 1 ]; then
  PERM=(--dangerously-skip-permissions)
  echo "[ralph] YOLO: полный автономный режим без подтверждений."
else
  PERM=(--permission-mode acceptEdits --allowedTools "Read,Edit,Write,Grep,Glob,Bash,Task,TodoWrite")
fi

PROMPT="$(cat ralph/PROMPT.md)"

for i in $(seq 1 "$MAX"); do
  [ -f ralph/STOP ] && { echo "[ralph] STOP-файл найден — стоп."; break; }

  stamp="$(date +%Y%m%d-%H%M%S)"
  log="ralph/logs/iter-$(printf '%03d' "$i")-$stamp.log"
  echo ""
  echo "=== [ralph] Итерация $i / $MAX ($stamp) ==="

  head_sha="$(git rev-parse HEAD)"

  claude -p "$PROMPT" --model "$MODEL" --max-turns 80 "${PERM[@]}" 2>&1 | tee "$log"

  if grep -q "RALPH: ALL DONE" "$log"; then
    echo "[ralph] Бэклог пуст (RALPH: ALL DONE). Готово."
    break
  fi

  if [ "$(git rev-parse HEAD)" = "$head_sha" ]; then
    echo "[ralph] Внимание: итерация без нового коммита (возможно BLOCKED). См. $log и PROGRESS.md."
  fi

  sleep 3
done

echo "[ralph] Цикл завершён. Логи: ralph/logs"
