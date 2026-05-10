#Requires -Version 5.1
<#
.SYNOPSIS
  One-time VPS prep for GitHub Actions CD — install git, upload rollout scripts.
  Loads ContentManager\.env.deploy (same as deploy-vps.sh).

.EXAMPLE
  cd ContentManager
  .\scripts\bootstrap-vps-cd.ps1
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $RepoRoot

$bash = Get-Command bash.exe -ErrorAction SilentlyContinue
if ($bash) {
    Write-Host 'Using bash to run scripts/bootstrap-vps-cd.sh ...'
    & bash.exe (Join-Path $RepoRoot 'scripts\bootstrap-vps-cd.sh')
    exit $LASTEXITCODE
}

$envFile = Join-Path $RepoRoot '.env.deploy'
if (-not (Test-Path $envFile)) {
    throw "Missing $envFile — copy from .env.deploy.example"
}

Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -match '^#' -or $line -eq '') { return }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $key = $line.Substring(0, $eq).Trim()
    $val = $line.Substring($eq + 1).Trim()
    Set-Item -Path "Env:$key" -Value $val
}

$VPS_USER = if ($env:VPS_USER) { $env:VPS_USER } else { 'root' }
if (-not $env:VPS_HOST) { throw 'VPS_HOST not set in .env.deploy' }
$VPS_PATH = if ($env:VPS_PATH) { $env:VPS_PATH } else { '/opt/contentvault' }

$Target = "$VPS_USER@$($env:VPS_HOST)"
$SshArgs = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', $Target)
$ScpArgs = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new')
Write-Host "=== Bootstrap VPS (no bash) → $Target : $VPS_PATH ==="

# Debian/Ubuntu-style install; Alpine: install git manually (apk add git).
$remotePrep = "export DEBIAN_FRONTEND=noninteractive; mkdir -p '$VPS_PATH/scripts'; command -v git >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq git; }; git --version"
ssh @SshArgs $remotePrep

$rollout = Join-Path $RepoRoot 'scripts\rollout-on-vps.sh'
$compose = Join-Path $RepoRoot 'scripts\compose-vps-files.sh'
$dest = "{0}/{1}" -f ($VPS_PATH.TrimEnd('/')), 'scripts/'
scp @ScpArgs $rollout $compose "${Target}:$dest"
ssh @SshArgs "chmod +x '$VPS_PATH/scripts/rollout-on-vps.sh' '$VPS_PATH/scripts/compose-vps-files.sh'"

ssh @SshArgs "bash -lc `"cd '$VPS_PATH' && if [ -d .git ]; then echo 'git repo OK'; git status -sb | head -3; else echo 'WARN: no .git — init or clone for CD'; fi`""
Write-Host '=== Done ==='
