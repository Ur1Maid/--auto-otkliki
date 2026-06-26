<#
.SYNOPSIS
  Регистрирует 3 задачи Windows Task Scheduler для hh-auto-otkliki.

.DESCRIPTION
  Демон НЕ крутится постоянно. Планировщик Windows ЗАПУСКАЕТ один шаг
  (node src/daemon.js --task <job>) и процесс выходит — дёшево по ресурсам.

    messages — каждые 10 минут (прочитать все письма)
    resume   — каждые 30 минут (обновить/поднять резюме)
    apply    — каждый день в 08:00 (пачка откликов)

  ВНИМАНИЕ про время: Task Scheduler использует ЛОКАЛЬНОЕ время машины.
  Для apply в 08:00 МСК часовой пояс машины должен быть МСК (или поправь -At).

  LIVE-режим (реальные действия) — флаг -Live. Без него dry-run (безопасно).
  Авто-ответы в чате — флаг -ReplyAuto.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\scheduler\register-windows-tasks.ps1 `
    -Accounts belonogov,fedorov,startsev -Text DevOps -Area 1 -Limit 200 -Live -ReplyAuto

.NOTES
  Удалить задачи:
    Get-ScheduledTask -TaskPath '\hh-auto-otkliki\' | Unregister-ScheduledTask -Confirm:$false
#>
param(
  [string[]] $Accounts = @('default'),
  [string]   $Text     = 'DevOps',
  [string]   $Area     = '1',
  [int]      $Limit    = 200,
  [switch]   $Live,
  [switch]   $ReplyAuto
)

$ErrorActionPreference = 'Stop'

# Корень репозитория = на два уровня выше этого скрипта.
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$node = (Get-Command node).Source
$accountsArg = ($Accounts -join ',')
$taskPath = '\hh-auto-otkliki\'

$liveArg  = if ($Live)      { ' --live' }       else { '' }
$replyArg = if ($ReplyAuto) { ' --reply-auto' } else { '' }

function New-DaemonAction([string] $extraArgs) {
  # cmd /c позволяет сменить каталог и перенаправить лог в одной строке.
  $cmd = "cd /d `"$repo`" && `"$node`" src\daemon.js $extraArgs"
  New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c $cmd"
}

# --- messages: каждые 10 минут ---
Register-ScheduledTask -Force -TaskPath $taskPath -TaskName 'messages' `
  -Action (New-DaemonAction "--task messages --accounts $accountsArg$liveArg$replyArg") `
  -Trigger (New-ScheduledTaskTrigger -Once -At (Get-Date) `
            -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration ([TimeSpan]::MaxValue)) `
  -Description 'hh-auto-otkliki: прочитать все письма (каждые 10 мин)'

# --- resume: каждые 30 минут ---
Register-ScheduledTask -Force -TaskPath $taskPath -TaskName 'resume' `
  -Action (New-DaemonAction "--task resume --accounts $accountsArg$liveArg") `
  -Trigger (New-ScheduledTaskTrigger -Once -At (Get-Date) `
            -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration ([TimeSpan]::MaxValue)) `
  -Description 'hh-auto-otkliki: обновить/поднять резюме (каждые 30 мин)'

# --- apply: ежедневно в 08:00 (локальное время машины = МСК) ---
Register-ScheduledTask -Force -TaskPath $taskPath -TaskName 'apply' `
  -Action (New-DaemonAction "--task apply --accounts $accountsArg --text $Text --area $Area --limit $Limit$liveArg") `
  -Trigger (New-ScheduledTaskTrigger -Daily -At '08:00') `
  -Description 'hh-auto-otkliki: пачка откликов (08:00 МСК)'

Write-Host ''
Write-Host 'Готово. Зарегистрированы задачи в \hh-auto-otkliki\: messages (10м), resume (30м), apply (08:00).'
Write-Host ("LIVE-режим: {0}; авто-ответы: {1}" -f $(if($Live){'ВКЛ'}else{'выкл (dry-run)'}), $(if($ReplyAuto){'ВКЛ'}else{'выкл'}))
