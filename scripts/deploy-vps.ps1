# ContentVault — deploy na VPS (PowerShell)
# Uzycie: .\scripts\deploy-vps.ps1 [-Build] [-Rebuild] [-Billionmail]
#   -Build       = sync + docker compose build + up
#   -Rebuild     = sync + pelna przebudowa od zera (zachowuje tylko postgres_data)
#   -Billionmail = uzyj docker-compose.billionmail.yml
# Wymaga: rsync (z Git Bash lub WSL) albo uzyj scp

param([switch]$Build, [switch]$Rebuild, [switch]$Billionmail)

# Laduj .env.deploy jesli istnieje
$deployEnv = Join-Path (Split-Path -Parent $PSScriptRoot) ".env.deploy"
if (Test-Path $deployEnv) {
  Get-Content $deployEnv | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$' -and $matches[1].Trim()) {
      [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
    }
  }
}

# IP/host NIE w repo - ustaw VPS_HOST, VPS_USER, VPS_PATH w env (lub .env.deploy)
$VPS_USER = if ($env:VPS_USER) { $env:VPS_USER } else { "marek" }
$VPS_HOST = $env:VPS_HOST
$VPS_PATH = if ($env:VPS_PATH) { $env:VPS_PATH } else { "/opt/contentvault" }
if (-not $VPS_HOST) { Write-Error "Ustaw VPS_HOST w srodowisku (np. export VPS_HOST=twoj-vps.example.com)"; exit 1 }
$RepoRoot = Split-Path -Parent $PSScriptRoot  # ContentManager/

Write-Host "=== ContentVault deploy ==="
Write-Host "Host: $VPS_USER@$VPS_HOST`:$VPS_PATH"
Write-Host ""

# Sync: rsync lub fallback tar+scp
$rsync = Get-Command rsync -ErrorAction SilentlyContinue
if ($rsync) {
  Write-Host "Syncing (rsync)..."
  & rsync -avz --delete `
  --exclude node_modules `
  --exclude .next `
  --exclude .git `
  --exclude uploads `
  --exclude "*.log" `
  --exclude .env `
  --exclude .env.local `
  "$RepoRoot/" "${VPS_USER}@${VPS_HOST}:${VPS_PATH}/"
} else {
  Write-Host "Brak rsync. Uzywam tar+scp (bez .env)..."
  $archive = Join-Path $env:TEMP "contentvault-deploy.tar"
  Push-Location $RepoRoot
  tar -cf $archive --exclude=node_modules --exclude=.next --exclude=.git --exclude=uploads --exclude="*.log" --exclude=.env --exclude=.env.local .
  Pop-Location
  scp $archive "${VPS_USER}@${VPS_HOST}:/tmp/"
  Remove-Item $archive -ErrorAction SilentlyContinue
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && tar xf /tmp/contentvault-deploy.tar && rm /tmp/contentvault-deploy.tar"
}

Write-Host ""
Write-Host "Starting on VPS..."

$composeFiles = "-f docker-compose.yml"
if ($Billionmail) { $composeFiles = "-f docker-compose.yml -f docker-compose.billionmail.yml" }

if ($Rebuild) {
  $bmArg = if ($Billionmail) { " --billionmail" } else { "" }
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && bash scripts/vps-rebuild.sh$bmArg"
} elseif ($Build) {
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && docker compose $composeFiles build && docker compose $composeFiles up -d"
} else {
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && docker compose $composeFiles up -d"
}

Write-Host ""
Write-Host "Done. Check: https://dyskiof.net"
