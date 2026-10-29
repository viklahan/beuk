<#
  Beuk Weekly drafter: one run (spec 2026-10-29; runbook docs/weekly-press.md).

  Registered by register-task.ps1 as two tasks: BeukWeeklyDrafter, Thursdays
  at 07:00 with -Weekly, and BeukWeeklyDrafterDaily, daily at 07:30. Both
  use StartWhenAvailable, so a missed Thursday drafts at the next wake,
  whatever day that is. What a run does is decided before any writing,
  so none of the subscription is spent on a run that cannot upload
  (plan-run.ts):
    a sent-back draft          rewrite it with the editor's notes
    -Weekly, nothing waiting   draft the new issue
    -Weekly, a draft waiting   no new draft; tell the editor it is waiting
    otherwise                  nothing to do

    powershell -File tools\weekly\draft.ps1 [-Server https://beuk.studio] [-Weekly] [-DryRun] [-Force] [-DraftFrom <folder>]

  -Weekly     this is the weekly run (the Thursday trigger passes it)
  -DryRun     draft and check, print what would be uploaded, upload nothing
  -Force      draft a new issue now, as a weekly run would
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
  [switch]$Weekly,
  [switch]$DryRun,
  [switch]$Force,
  [string]$DraftFrom = ''
)
$ErrorActionPreference = 'Stop'
# Text piped into claude is UTF-8: Windows PowerShell 5.1 would send US-ASCII,
# turning the brief's dashes and the editor's dictated quotes into '?'.
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
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
  Write-Host $l
  Add-Content -Path $Log -Value $l -Encoding UTF8
}

# A native command's stderr must not end the run: Windows PowerShell 5.1
# turns redirected stderr into error records, and 'Stop' makes those fatal
# (git prints progress there). Native steps are judged by their exit code.
function Native([scriptblock]$block) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $out = & $block 2>&1 | ForEach-Object { "$_" } | Out-String; return @{ Code = $LASTEXITCODE; Out = $out } }
  finally { $ErrorActionPreference = $prev }
}

function Node-Tool([string]$name, [string[]]$toolArgs) {
  # From the repo, so `--import tsx` resolves against its node_modules.
  Push-Location $Repo
  try { $r = Native { & node --import tsx (Join-Path $Repo "tools\weekly\$name") @toolArgs } }
  finally { Pop-Location }
  foreach ($l in ($r.Out.TrimEnd() -split "`r?`n")) { if ($l) { Say "  $l" } }
  return $r
}

# Invoke-RestMethod hands a JSON [] to @() as one empty element in
# PowerShell 5.1; keep only real rows. Call it inside @(...): a function's one-row
# array unrolls to a bare object, which has no .Count in 5.1.
function Rows($value) { return @(@($value) | Where-Object { $_ -and $_.id }) }

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

  # 4. What this run does, decided before anything is written.
  $Step = 'queue'
  $planArgs = @('--server', $Server)
  if ($Weekly) { $planArgs += '--weekly' }
  if ($Force) { $planArgs += '--force' }
  $planned = Node-Tool 'plan-run.ts' $planArgs
  if ($planned.Code -ne 0) { throw "could not plan the run: $($planned.Out.Trim())" }
  $plan = ($planned.Out.Trim() -split "`r?`n")[-1] | ConvertFrom-Json
  $replaces = $null; $notes = $null
  switch ($plan.action) {
    'rewrite' { $replaces = $plan.replaces; $notes = $plan.notes; Say "rewriting sent-back draft $replaces" }
    'new' { Say 'drafting a new issue' }
    'waiting' {
      $reason = "last week's draft is still waiting: $($plan.previewUrl)"
      Say "$reason (no new draft this week)"
      if (-not $DryRun) { Node-Tool 'upload.ts' @('--failed', $reason, '--server', $Server) | Out-Null }
      $Step = 'done'
      exit 0
    }
    default { Say "nothing to do: $($plan.why)"; $Step = 'done'; exit 0 }
  }

  # Where "what shipped" starts: the last published issue's commit, else
  # the commit that last touched the newest issue in git.
  $Step = 'range'
  $published = @(Rows (Api '/api/weekly/drafts?status=published'))
  $from = $null
  if ($published.Count -gt 0) { $from = $published[0].sourceCommit }
  else {
    $latest = Get-ChildItem (Join-Path $Repo 'content\weekly\en') -Directory | Where-Object Name -match '^\d{3}$' | Sort-Object Name | Select-Object -Last 1
    if ($latest) { $from = (Native { & git -C $Repo log -1 --format=%H -- "content/weekly/en/$($latest.Name)" }).Out.Trim() }
  }
  $range = if ($buildIsCommit -and $from) { "$from..$build" } else { $null }
  Say "shipped range: $(if ($range) { $range } else { 'unavailable' })"

  # 5. A clean worktree at what is live (or local main when the build is not a commit).
  $Step = 'worktree'
  $at = if ($buildIsCommit) { $build } else { 'main' }
  if ((Native { & git -C $Repo cat-file -e "$at^{commit}" }).Code -ne 0) { throw "commit $at is not in $Repo; pull main first" }
  New-Item -ItemType Directory -Force (Split-Path $Work) | Out-Null
  $wt = Native { & git -C $Repo worktree add --detach $Work $at }
  if ($wt.Code -ne 0) { throw "git worktree add failed for $at`: $($wt.Out.Trim())" }
  $worktreeMade = $true
  $sourceCommit = (Native { & git -C $Work rev-parse HEAD }).Out.Trim()
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
    $prompt = (Get-Content (Join-Path $Repo 'tools\weekly\SKILL.md') -Raw -Encoding UTF8) + $run
    Push-Location $Work
    try {
      $json = (Native { $prompt | & claude -p --output-format json --permission-mode acceptEdits `
        --allowedTools 'Read' 'Glob' 'Grep' 'Write' 'Edit' 'WebSearch' 'WebFetch' 'Bash(git log:*)' 'Bash(git show:*)' 'Bash(git diff:*)' }).Out
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
  $pics = Node-Tool 'pictures.ts' @($Out, '--inbox', (Join-Path $Repo 'content\weekly\inbox'))
  # A broken pictures step does not stop the issue: every story it left
  # without a picture is in no-pictures.json, and the email says so.
  if ($pics.Code -ne 0) { Say 'the pictures step failed; the draft goes without generated pictures and the email lists them' }

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
    Native { & git -C $Repo worktree remove --force $Work } | Out-Null
  }
}
