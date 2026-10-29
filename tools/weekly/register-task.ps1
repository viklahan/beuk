<#
  Registers the Beuk Weekly drafter with Windows Task Scheduler as
  "BeukWeeklyDrafter": weekly on Thursday at 07:00, and daily at 07:30 (the
  daily run only works when the editor sent a draft back). StartWhenAvailable
  makes a missed start run at the next wake, so a Thursday with the laptop
  off drafts late rather than not at all.

    powershell -File tools\weekly\register-task.ps1 [-Server https://beuk.studio]

  Runs as the signed-in user (claude's subscription login lives in that
  user's profile). Remove with: Unregister-ScheduledTask BeukWeeklyDrafter
#>
param([string]$Server = 'https://beuk.studio')
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'draft.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -Server $Server"
$triggers = @(
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Thursday -At '07:00'),
  (New-ScheduledTaskTrigger -Daily -At '07:30')
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'BeukWeeklyDrafter' -Action $action -Trigger $triggers -Settings $settings -Description 'Beuk Weekly drafter (tools/weekly/draft.ps1): drafts the issue and uploads it for the editor''s approval. Never publishes.' -Force | Out-Null
Write-Output "registered BeukWeeklyDrafter: Thursday 07:00 and daily 07:30, StartWhenAvailable, server $Server"
