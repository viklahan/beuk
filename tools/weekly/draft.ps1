<#
  Beuk Weekly drafter: one run (spec 2026-10-29; runbook docs/weekly-press.md).

  Registered by register-task.ps1 to run on Thursdays at 07:00 and daily at
  07:30 (StartWhenAvailable, so a missed Thursday runs at next wake). A
  daily run only does work when the editor has sent a draft back.

    powershell -File tools\weekly\draft.ps1 [-Server https://beuk.studio] [-DryRun] [-Force] [-DraftFrom <folder>]

  -DryRun     draft and check, print what would be uploaded, upload nothing
  -Force      draft a new issue even when it is not Thursday
  -DraftFrom  skip the writing step and use an already-drafted folder (for
              testing the rest of the run without calling claude)

  The writer is `claude -p` on V's Claude SUBSCRIPTION login. The API-key
  variables are cleared for this process first, so no API credits can be
  used. The press token comes from Windows Credential Manager (generic
  credential "BeukWeeklyDraftToken"), or from $env:BEUK_WEEKLY_TOKEN.
  Every run is logged under %LOCALAPPDATA%\beuk-weekly\logs\. A run that
  fails tells the server (V gets "no draft this week, here's why"). If
  even that fails, a toast is shown when BurntToast is installed, and the
  log is the record.
#>
param(
  [string]$Server = 'https://beuk.studio',
  [switch]$DryRun,
  [switch]$Force,
  [string]$DraftFrom = ''
)
$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Home_ = Join-Path $env:LOCALAPPDATA 'beuk-weekly'
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$LogDir = Join-Path $Home_ 'logs'
New-Item -ItemType Directory -Force $LogDir | Out-Null
$Log = Join-Path $LogDir "$Stamp.log"
$Work = Join-Path $Home_ "work\$Stamp"
$Step = 'start'
$Server = $Server.TrimEnd('/')

function Say([string]$line) {
  $l = "$(Get-Date -Format 'HH:mm:ss') [$Step] $line"
  Write-Output $l
  Add-Content -Path $Log -Value $l -Encoding UTF8
}

function Node-Tool([string]$name, [string[]]$toolArgs) {
  $out = & node --import tsx (Join-Path $Repo "tools\weekly\$name") @toolArgs 2>&1 | Out-String
  $code = $LASTEXITCODE
  foreach ($l in ($out.TrimEnd() -split "`r?`n")) { if ($l) { Say "  $l" } }
  return @{ Code = $code; Out = $out }
}

function Read-StoredToken {
  if ($env:BEUK_WEEKLY_TOKEN) { return $env:BEUK_WEEKLY_TOKEN }
  # Windows Credential Manager, generic credential "BeukWeeklyDraftToken" (CredRead, advapi32).
  Add-Type -Namespace BeukWeekly -Name Cred -MemberDefinition @'
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential, CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public long LastWritten; public int CredentialBlobSize; public System.IntPtr CredentialBlob; public int Persist; public int AttributeCount; public System.IntPtr Attributes; public string TargetAlias; public string UserName; }
[System.Runtime.InteropServices.DllImport("advapi32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
public static extern bool CredRead(string target, int type, int flags, out System.IntPtr cred);
[System.Runtime.InteropServices.DllImport("advapi32.dll")]
public static extern void CredFree(System.IntPtr cred);
public static string Read(string target) {
  System.IntPtr p;
  if (!CredRead(target, 1, 0, out p)) return null;
  try {
    CREDENTIAL c = (CREDENTIAL)System.Runtime.InteropServices.Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    return System.Runtime.InteropServices.Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
  } finally { CredFree(p); }
}
'@ -ErrorAction SilentlyContinue
  return [BeukWeekly.Cred]::Read('BeukWeeklyDraftToken')
}

function Api([string]$path) {
  return Invoke-RestMethod -Uri "$Server$path" -Headers @{ Authorization = "Bearer $env:BEUK_WEEKLY_TOKEN" } -TimeoutSec 30
}

$worktreeMade = $false
try {
  # 1. No API key can reach claude: the subscription login is the only way in.
  $Step = 'auth'
  foreach ($n in 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_API_KEY') {
    if (Test-Path "Env:$n") { Remove-Item "Env:$n"; Say "cleared $n for this run" }
  }
  Say "API-key variables cleared; claude will use the subscription login"

  # 2. The press token.
  $Step = 'token'
  $token = Read-StoredToken
  if (-not $token) { throw 'no press token: set the generic credential BeukWeeklyDraftToken (docs/weekly-press.md)' }
  $env:BEUK_WEEKLY_TOKEN = $token

  # 3. What is live on the server.
  $Step = 'status'
  $status = Invoke-RestMethod -Uri "$Server/api/status" -TimeoutSec 30
  $build = [string]$status.build
  $buildIsCommit = $build -match '^[0-9a-f]{40}$'
  Say "server build: $build$(if (-not $buildIsCommit) { ' (not a commit: no shipped stories this run)' })"

  # 4. A sent-back draft first; otherwise a new issue on Thursdays.
  $Step = 'queue'
  $back = @(Api '/api/weekly/drafts?status=sent_back')
  $replaces = $null; $notes = $null
  if ($back.Count -gt 0) {
    $replaces = $back[0].id; $notes = $back[0].notes
    Say "rewriting sent-back draft $replaces"
  } elseif ((Get-Date).DayOfWeek -eq 'Thursday' -or $Force -or $DraftFrom) {
    Say 'drafting a new issue'
  } else {
    Say 'nothing to do today (not Thursday, nothing sent back)'
    exit 0
  }

  # Where "what shipped" starts: the last published issue's commit, else
  # the commit that last touched the newest issue in git.
  $Step = 'range'
  $published = @(Api '/api/weekly/drafts?status=published')
  $from = $null
  if ($published.Count -gt 0) { $from = $published[0].sourceCommit }
  else {
    $latest = Get-ChildItem (Join-Path $Repo 'content\weekly\en') -Directory | Where-Object Name -match '^\d{3}$' | Sort-Object Name | Select-Object -Last 1
    if ($latest) { $from = (& git -C $Repo log -1 --format=%H -- "content/weekly/en/$($latest.Name)").Trim() }
  }
  $range = if ($buildIsCommit -and $from) { "$from..$build" } else { $null }
  Say "shipped range: $(if ($range) { $range } else { 'unavailable' })"

  # 5. A clean worktree at what is live (or local main when the build is not a commit).
  $Step = 'worktree'
  $at = if ($buildIsCommit) { $build } else { 'main' }
  & git -C $Repo cat-file -e "$at^{commit}" 2>$null
  if ($LASTEXITCODE -ne 0) { throw "commit $at is not in $Repo; pull main first" }
  New-Item -ItemType Directory -Force (Split-Path $Work) | Out-Null
  & git -C $Repo worktree add --detach $Work $at 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "git worktree add failed for $at" }
  $worktreeMade = $true
  $sourceCommit = (& git -C $Work rev-parse HEAD).Trim()
  $Out = Join-Path $Work 'weekly-draft'
  New-Item -ItemType Directory -Force $Out | Out-Null

  # 6. Write the issue.
  $Step = 'write'
  if ($DraftFrom) {
    Copy-Item (Join-Path $DraftFrom '*') $Out
    Say "used the drafted folder $DraftFrom (no claude call)"
  } else {
    $run = @"

## Run

- Output folder: weekly-draft/ (in the current directory; write nothing anywhere else)
- Today: $(Get-Date -Format 'yyyy-MM-dd') ($((Get-Date).DayOfWeek))
- The code is checked out at commit $sourceCommit
- Commit range for what shipped: $(if ($range) { $range } else { "unavailable: the server's build stamp ($build) is not a commit, so write no shipped stories and say why in dropped.json" })
- Notices supplied by the editor: none
- Editor's notes on the draft you are rewriting: $(if ($notes) { $notes } else { 'none (this is a new issue)' })
"@
    $prompt = (Get-Content (Join-Path $Repo 'tools\weekly\SKILL.md') -Raw) + $run
    Push-Location $Work
    try {
      $json = $prompt | & claude -p --output-format json --permission-mode acceptEdits `
        --allowedTools 'Read' 'Glob' 'Grep' 'Write' 'Edit' 'WebSearch' 'WebFetch' 'Bash(git log:*)' 'Bash(git show:*)' 'Bash(git diff:*)' 2>&1 | Out-String
    } finally { Pop-Location }
    Add-Content -Path $Log -Value $json -Encoding UTF8
    $result = $null
    try { $result = $json | ConvertFrom-Json } catch { throw "claude did not answer with JSON (is it installed and logged in?): $($json.Substring(0, [Math]::Min(300, $json.Length)))" }
    if ($result.is_error) { throw "claude stopped with an error: $($result.result)" }
    Say "claude finished: $($result.num_turns) turns"
  }
  if (-not (Test-Path (Join-Path $Out 'issue.md'))) { throw 'the writing step left no issue.md' }

  # 7. Pictures: V's inbox, then the local model; Gemini and Muse are placeholders.
  $Step = 'pictures'
  Node-Tool 'pictures.ts' @($Out, '--inbox', (Join-Path $Repo 'content\weekly\inbox')) | Out-Null

  # 8. The server's own checks, before anything is sent.
  $Step = 'check'
  $check = Node-Tool 'check-draft.ts' @($Out)
  if ($check.Code -ne 0) { throw "the draft failed its checks: $($check.Out.Trim())" }

  # 9. Upload (or, dry, say what would go).
  $Step = 'upload'
  if ($DryRun) {
    Say "dry run: would upload $((Get-ChildItem $Out -File).Count) files from $Out (commit $sourceCommit)$(if ($replaces) { " replacing $replaces" })"
    Get-ChildItem $Out -File | ForEach-Object { Say "  $($_.Name)  $($_.Length) bytes" }
  } else {
    $upArgs = @($Out, '--server', $Server, '--commit', $sourceCommit)
    if ($replaces) { $upArgs += @('--replaces', $replaces) }
    $up = Node-Tool 'upload.ts' $upArgs
    if ($up.Code -eq 3) { Say 'a draft is already waiting; the editor has been told'; $Step = 'done'; return }
    if ($up.Code -ne 0) { throw "upload failed (exit $($up.Code))" }
  }
  $Step = 'done'
  Say 'run finished'
} catch {
  $msg = "$Step`: $($_.Exception.Message)"
  Say "FAILED $msg"
  if (-not $DryRun -and $env:BEUK_WEEKLY_TOKEN) {
    $r = Node-Tool 'upload.ts' @('--failed', $msg, '--server', $Server)
    if ($r.Code -eq 0) { Say 'the editor has been told' }
  } else { $r = @{ Code = 1 } }
  if ($r.Code -ne 0 -and (Get-Command New-BurntToastNotification -ErrorAction SilentlyContinue)) {
    New-BurntToastNotification -Text 'Beuk Weekly drafter failed', $msg
  }
  exit 1
} finally {
  if ($worktreeMade) {
    & git -C $Repo worktree remove --force $Work 2>&1 | Out-Null
  }
}
