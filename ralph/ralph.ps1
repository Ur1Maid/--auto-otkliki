<#
.SYNOPSIS
  Ralph — автономный цикл Claude Code для hh-auto-otkliki.
  Каждую итерацию запускает headless `claude` с ralph/PROMPT.md: агент берёт одну задачу из
  ralph/ROADMAP.md, делает её, верифицирует (npm test + ревьюеры), коммитит, отмечает [x].

.DESCRIPTION
  Состояние между итерациями живёт только в ROADMAP.md / PROGRESS.md (агент без памяти).
  Цикл останавливается при: файле ralph/STOP, достижении -MaxIterations, или строке
  "RALPH: ALL DONE" в выводе.

.PARAMETER MaxIterations  Максимум итераций (защита от runaway). По умолчанию 30.
.PARAMETER Model          Модель оркестратора. По умолчанию claude-opus-4-8 (Opus думает/верифицирует).
.PARAMETER Yolo           Полный автономный режим: --dangerously-skip-permissions. ОПАСНО, см. README.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File ralph\ralph.ps1
  powershell -ExecutionPolicy Bypass -File ralph\ralph.ps1 -MaxIterations 10 -Yolo
#>
param(
  [int]$MaxIterations = 30,
  [string]$Model = "claude-opus-4-8",
  [switch]$Yolo
)

$ErrorActionPreference = "Stop"
$ralphDir = $PSScriptRoot
$root = Split-Path -Parent $ralphDir
Set-Location $root

$promptPath = Join-Path $ralphDir "PROMPT.md"
$stopFile   = Join-Path $ralphDir "STOP"
$logDir     = Join-Path $ralphDir "logs"
New-Item -ItemType Directory -Force $logDir | Out-Null

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  throw "CLI 'claude' не найден в PATH. Установи Claude Code и убедись, что 'claude' доступен."
}

# Работаем в изолированной ветке, не на main.
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne "ralph/auto") {
  Write-Host "[ralph] Текущая ветка '$branch'. Переключаюсь на 'ralph/auto'." -ForegroundColor Yellow
  git show-ref --verify --quiet refs/heads/ralph/auto
  if ($?) { git checkout ralph/auto } else { git checkout -b ralph/auto }
}

# Аргументы прав доступа для headless-режима.
if ($Yolo) {
  $permArgs = @("--dangerously-skip-permissions")
  Write-Host "[ralph] YOLO: полный автономный режим без подтверждений." -ForegroundColor Red
} else {
  $permArgs = @("--permission-mode", "acceptEdits",
                "--allowedTools", "Read,Edit,Write,Grep,Glob,Bash,Task,TodoWrite")
}

$prompt = Get-Content -Raw $promptPath

for ($i = 1; $i -le $MaxIterations; $i++) {
  if (Test-Path $stopFile) {
    Write-Host "[ralph] Найден файл STOP — останавливаюсь." -ForegroundColor Yellow
    break
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $log = Join-Path $logDir ("iter-{0:000}-{1}.log" -f $i, $stamp)
  Write-Host "`n=== [ralph] Итерация $i / $MaxIterations ($stamp) ===" -ForegroundColor Cyan

  $headSha = (git rev-parse HEAD).Trim()

  & claude -p $prompt --model $Model --max-turns 80 @permArgs 2>&1 |
    Tee-Object -FilePath $log

  if (Select-String -Path $log -Pattern "RALPH: ALL DONE" -Quiet) {
    Write-Host "[ralph] Бэклог пуст (RALPH: ALL DONE). Готово." -ForegroundColor Green
    break
  }

  # Защита от застревания: если за итерацию не появилось нового коммита — предупреждаем.
  $newSha = (git rev-parse HEAD).Trim()
  if ($newSha -eq $headSha) {
    Write-Host "[ralph] Внимание: итерация без нового коммита (возможно BLOCKED). Смотри $log и PROGRESS.md." -ForegroundColor Yellow
  }

  Start-Sleep -Seconds 3
}

Write-Host "[ralph] Цикл завершён. Логи: $logDir" -ForegroundColor Cyan
