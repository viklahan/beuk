# Beuk — local startup (Windows / Docker Desktop).
#
# One command to get a clean local stack on port 8090, on EVERY address
# this machine has (localhost, Wi-Fi, Ethernet, IPv4 and IPv6), whatever
# network it is on:
#   1. stops stray Beuk dev servers from ANY copy of the project
#      (node processes whose command line points into Projects\beuk*),
#   2. takes the first free port from 8090 up: if something else already
#      listens on 8090 it is left running and Beuk moves to 8091, 8092, …,
#   3. builds and starts this stack (db + app + caddy), with the tools
#      overlay when tools-bin/epubcheck.jar is present,
#   4. waits for /api/health and prints every http://<address>:<port>.
#
# Usage:  .\start-local.ps1            # start / restart
#         .\start-local.ps1 -Down      # stop this stack
#         .\start-local.ps1 -NoBuild   # restart without rebuilding images
#         .\start-local.ps1 -Port 9000 # start the free-port search at 9000
#         .\start-local.ps1 -LocalOnly # this machine only (127.0.0.1)
#
# Every address is the default (V, 2026-10-29: "if the device has an IP,
# we should be running on that ip:port"). It is plain http: the studio
# works, but browsers only allow its service worker (offline, install)
# on https or localhost. -Lan is still accepted and changes nothing.

param(
  [switch]$Down,
  [switch]$NoBuild,
  [switch]$LocalOnly,
  [switch]$Lan,
  [int]$Port = 8090
)

# Not 'Stop': docker writes progress to stderr, which Windows PowerShell
# would turn into a terminating error. Native steps check $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
Set-Location $root
$project = 'beuk-saas'
$Lan = -not $LocalOnly

function Note($msg) { Write-Host "[beuk] $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "[beuk] $msg" -ForegroundColor Yellow }

$override = Join-Path $root 'docker-compose.override.yml'
function ComposeArgs {
  $f = @('-f', 'docker-compose.yml')
  if (Test-Path (Join-Path $root 'tools-bin\epubcheck.jar')) { $f += @('-f', 'deploy/docker-compose.tools.yml') }
  if (Test-Path $override) { $f += @('-f', 'docker-compose.override.yml') }
  return @('compose', '-p', $project) + $f
}

if ($Down) {
  $compose = ComposeArgs
  & docker @compose down
  exit $LASTEXITCODE
}

if (-not (Test-Path (Join-Path $root 'tools-bin\epubcheck.jar'))) {
  Warn 'tools-bin/epubcheck.jar not found: EPUBCheck / PDF-X jobs will report "not configured".'
}

if (-not (Test-Path (Join-Path $root '.env'))) {
  # Local values: plain HTTP on the override port (no dev CA, no 443).
  (Get-Content (Join-Path $root '.env.example')) `
    -replace '^DOMAIN=.*', "DOMAIN=http://localhost:$Port" `
    -replace '^APP_BASE_URL=.*', "APP_BASE_URL=http://localhost:$Port" `
    -replace '^COOKIE_SECURE=.*', 'COOKIE_SECURE=false' |
    Out-File -FilePath (Join-Path $root '.env') -Encoding utf8
  Warn '.env was missing: created from .env.example with local-only defaults.'
}

# 1. Stray Beuk dev servers from any copy of the project.
$strays = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -match '\\Projects\\beuk[^\\]*\\' }
foreach ($p in $strays) {
  Note "stopping stray node pid $($p.ProcessId): $($p.CommandLine.Substring(0, [Math]::Min(120, $p.CommandLine.Length)))"
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

# 2. The first free port from $Port up. A port this stack's own Caddy
# already publishes counts as free (the restart below takes it back);
# anything else listening on it (another Beuk copy, another app) is left
# running and Beuk moves up one.
$wanted = $Port
$ours = @(docker ps -q --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.service=caddy')
function PortTaken($p) {
  foreach ($id in $ours) {
    if ($id -and (docker port $id 2>$null | Select-String -Quiet ":$p`$")) { return $false }
  }
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue)
}
while (PortTaken $Port) {
  if ($Port -ge $wanted + 50) { Warn "no free port in $wanted..$Port"; exit 1 }
  $Port++
}
if ($Port -ne $wanted) { Warn "port $wanted is in use by something else; Beuk takes $Port" }

# The local port override (git-ignored, written fresh on every run so the
# port and -LocalOnly switch cleanly). With no host address Docker
# publishes the port on every interface, IPv4 and IPv6. Caddy answers to
# any host name on that port (the .env DOMAIN names localhost only, so a
# tablet asking for 192.168.x.x would otherwise get nothing). When the
# port moved, the app's own links (APP_BASE_URL) move with it.
$publish = if ($Lan) { "${Port}:${Port}" } else { "127.0.0.1:${Port}:${Port}" }
$siteAddr = if ($Lan) { "http://:${Port}" } else { "http://localhost:${Port}" }
$appEnv = if ($Port -ne $wanted) { "`n  app:`n    environment:`n      APP_BASE_URL: `"http://localhost:${Port}`"" } else { "" }
@"
# LOCAL ONLY (git-ignored): serve Beuk on port $Port instead of 80/443.
# Generated by start-local.ps1$(if ($Lan) { ': every address on this machine' } else { ' -LocalOnly: localhost only' }).
services:
  caddy:
    ports: !override
      - "$publish"
    environment:
      DOMAIN: "$siteAddr"$appEnv
"@ | Out-File -FilePath $override -Encoding utf8
Note "wrote docker-compose.override.yml ($publish)"
$compose = ComposeArgs

# 3. Up. The tools overlay builds FROM beuk-app:latest, so build the base first.
if (-not $NoBuild) {
  Note 'building images'
  & docker compose -p $project -f docker-compose.yml build app
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  & docker @compose build
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
& docker @compose up -d --remove-orphans
if ($LASTEXITCODE) { exit $LASTEXITCODE }
# The Caddyfile is a bind mount: 'up' leaves a running caddy on its old
# config, so restart it to pick up any edit.
& docker @compose restart caddy | Out-Null

# 4. Health.
$url = "http://localhost:$Port"
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "$url/api/health"
    if ($r.StatusCode -eq 200) {
      Note "up: $url  ($($r.Content))"
      if ($Lan) {
        $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
          Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -ne 'WellKnown' } |
          Select-Object -ExpandProperty IPAddress
        foreach ($ip in $ips) { Note "on this machine's network: http://${ip}:$Port" }
        Warn "plain http: offline mode and app install need https or localhost."
        Warn "If another device can't connect, Windows Firewall is blocking it. Once, in an Administrator PowerShell:"
        Warn "  New-NetFirewallRule -DisplayName 'Beuk local' -Direction Inbound -Protocol TCP -LocalPort $wanted-$($wanted + 50) -Action Allow -Profile Any"
      }
      exit 0
    }
  } catch { }
  Start-Sleep -Seconds 2
}
Warn "no healthy /api/health after 120s; check: docker compose -p $project logs app"
exit 1
