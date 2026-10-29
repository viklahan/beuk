<#
  Registers the Beuk Weekly drafter with Windows Task Scheduler as two tasks:
    BeukWeeklyDrafter       Thursday 07:00, draft.ps1 -Weekly: drafts the issue
    BeukWeeklyDrafterDaily  daily 07:30: rewrites a draft the editor sent back
  StartWhenAvailable makes a missed start run at the next wake, so a Thursday
  with the laptop off drafts late (with -Weekly) rather than not at all. The
  daily task never drafts a new issue, so it cannot draft twice in a week.

    powershell -File tools\weekly\register-task.ps1 [-Server https://beuk.studio]

  Runs as the signed-in user (claude's subscription login lives in that
  user's profile). Remove with:
    Unregister-ScheduledTask BeukWeeklyDrafter; Unregister-ScheduledTask BeukWeeklyDrafterDaily
#>
param([string]$Server = 'https://beuk.studio')
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'draft.ps1'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
$base = "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -Server $Server"
Register-ScheduledTask -TaskName 'BeukWeeklyDrafter' `
  -Action (New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "$base -Weekly") `
  -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Thursday -At '07:00') -Settings $settings `
  -Description 'Beuk Weekly drafter (tools/weekly/draft.ps1 -Weekly): drafts the issue and uploads it for the editor''s approval. Never publishes.' -Force | Out-Null
Register-ScheduledTask -TaskName 'BeukWeeklyDrafterDaily' `
  -Action (New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $base) `
  -Trigger (New-ScheduledTaskTrigger -Daily -At '07:30') -Settings $settings `
  -Description 'Beuk Weekly drafter (tools/weekly/draft.ps1): rewrites a draft the editor sent back. Never publishes.' -Force | Out-Null
Write-Output "registered BeukWeeklyDrafter (Thursday 07:00, -Weekly) and BeukWeeklyDrafterDaily (daily 07:30), StartWhenAvailable, server $Server"
