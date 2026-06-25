<#
.SYNOPSIS
  Регистрирует ежедневную задачу Windows Task Scheduler для запуска демона hh-auto-otkliki.

.DESCRIPTION
  Создаёт задачу, которая раз в день запускает `node src/daemon.js`. По умолчанию демон
  работает в БЕЗОПАСНОМ dry-run режиме (ничего не уходит наружу) — чтобы включить live-режим,
  передайте `-DaemonArgs '--no-dry-run'` (с полным пониманием последствий).

  Таймзона: Task Scheduler использует ЛОКАЛЬНОЕ время ПК. Сам демон внутри ограничивает
  активность рабочими часами Europe/Moscow (09:00–18:00 МСК, см. src/lib/schedule.js) независимо
  от TZ ПК — вне окна МСК он просто IDLE/STOP. Поэтому достаточно стартовать его утром; если TZ
  ПК ≠ МСК, подберите -StartTime так, чтобы старт попадал в рабочее окно МСК.

  Скрипт ТОЛЬКО регистрирует задачу. Он НЕ запускает демон немедленно.

.PARAMETER TaskName
  Имя задачи в планировщике. По умолчанию 'hh-auto-otkliki-daemon'.

.PARAMETER StartTime
  Время ежедневного запуска (локальное время ПК), формат HH:mm. По умолчанию '09:00'.

.PARAMETER DaemonArgs
  Доп. аргументы для демона (строка). Напр. '--accounts acc1,acc2 --text DevOps --limit 200'.
  По умолчанию пусто → демон стартует с безопасными дефолтами (dry-run, аккаунт default).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1
  # Регистрирует задачу на 09:00 в dry-run.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1 -DaemonArgs '--accounts acc1,acc2 --text DevOps'
  # Dry-run, два аккаунта, поиск DevOps. Live-режим — добавьте '--no-dry-run' осознанно.

.NOTES
  Проверить регистрацию: schtasks /query /TN "hh-auto-otkliki-daemon" /V /FO LIST
  Удалить: scripts\unregister-task.ps1
#>
[CmdletBinding()]
param(
  [string]$TaskName = 'hh-auto-otkliki-daemon',
  [string]$StartTime = '09:00',
  [string]$DaemonArgs = ''
)

$ErrorActionPreference = 'Stop'

# Корень репозитория = родитель папки scripts/.
$RepoRoot = Split-Path -Parent $PSScriptRoot
$DaemonScript = Join-Path $RepoRoot 'src\daemon.js'

if (-not (Test-Path $DaemonScript)) {
  throw "Не найден $DaemonScript — запускайте скрипт из репозитория hh-auto-otkliki."
}

# Полный путь к node (в задаче PATH может отличаться — фиксируем абсолютный путь).
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
  throw "node не найден в PATH. Установите Node.js >=20 и повторите."
}
$NodePath = $NodeCmd.Source

# Аргументы действия: src\daemon.js + пользовательские аргументы демона.
$Arguments = "`"$DaemonScript`""
if ($DaemonArgs.Trim().Length -gt 0) {
  $Arguments = "$Arguments $DaemonArgs"
}

Write-Host "Регистрация задачи '$TaskName':" -ForegroundColor Cyan
Write-Host "  node:       $NodePath"
Write-Host "  скрипт:     $DaemonScript"
Write-Host "  аргументы:  $(if ($DaemonArgs.Trim()) { $DaemonArgs } else { '(дефолты, dry-run)' })"
Write-Host "  время:      ежедневно в $StartTime (локальное время ПК)"
Write-Host ""

$Action = New-ScheduledTaskAction -Execute $NodePath -Argument $Arguments -WorkingDirectory $RepoRoot
$Trigger = New-ScheduledTaskTrigger -Daily -At $StartTime
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Hours 12)

# Если задача с таким именем уже есть — перерегистрируем (idempotent).
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Задача '$TaskName' уже существует — перерегистрирую." -ForegroundColor Yellow
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings `
  -Description 'hh-auto-otkliki: дневной демон (dry-run по умолчанию). Старт ограничен 09:00-18:00 МСК внутри самого демона.' | Out-Null

Write-Host "Готово. Задача '$TaskName' зарегистрирована." -ForegroundColor Green
Write-Host "Проверить: schtasks /query /TN `"$TaskName`" /V /FO LIST"
Write-Host "Удалить:   powershell -ExecutionPolicy Bypass -File scripts\unregister-task.ps1"
Write-Host ""
Write-Host "ВНИМАНИЕ: задача стартует демон в dry-run, ЕСЛИ вы не передали --no-dry-run/--live." -ForegroundColor Yellow
