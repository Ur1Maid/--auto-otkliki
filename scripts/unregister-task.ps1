<#
.SYNOPSIS
  Удаляет задачу Windows Task Scheduler демона hh-auto-otkliki.

.DESCRIPTION
  Снимает регистрацию задачи, созданной scripts\register-task.ps1. Если задачи нет —
  сообщает об этом и завершается без ошибки.

.PARAMETER TaskName
  Имя задачи. По умолчанию 'hh-auto-otkliki-daemon' (как в register-task.ps1).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\unregister-task.ps1
#>
[CmdletBinding()]
param(
  [string]$TaskName = 'hh-auto-otkliki-daemon'
)

$ErrorActionPreference = 'Stop'

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $existing) {
  Write-Host "Задача '$TaskName' не найдена — нечего удалять." -ForegroundColor Yellow
  return
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Задача '$TaskName' удалена." -ForegroundColor Green
