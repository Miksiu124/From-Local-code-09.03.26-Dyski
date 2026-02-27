# ContentVault — deploy na VPS (PowerShell)
# Uzycie: .\scripts\deploy-vps.ps1 [-Build]
# Wymaga: rsync (z Git Bash lub WSL) albo uzyj scp

param([switch]$Build)

$VPS_USER = if ($env:VPS_USER) { $env:VPS_USER } else { "marek" }
$VPS_HOST = if ($env:VPS_HOST) { $env:VPS_HOST } else { "136.114.88.152" }
$VPS_PATH = if ($env:VPS_PATH) { $env:VPS_PATH } else { "/opt/contentvault" }
$RepoRoot = Split-Path -Parent $PSScriptRoot  # ContentManager/

Write-Host "=== ContentVault deploy ==="
Write-Host "Host: $VPS_USER@$VPS_HOST`:$VPS_PATH"
Write-Host ""

# Sprawdz czy rsync jest dostepny (Git Bash)
$rsync = Get-Command rsync -ErrorAction SilentlyContinue
if (-not $rsync) {
  Write-Host "Brak rsync. Uzyj scp lub zainstaluj Git for Windows (zawiera rsync)."
  Write-Host ""
  Write-Host "Alternatywa - scp calego ContentManager:"
  Write-Host "  scp -r contentvault-folder marek@136.114.88.152:/opt/"
  Write-Host ""
  Write-Host "Potem na VPS: cd /opt/contentvault && docker compose build && docker compose up -d"
  exit 1
}

Write-Host "Syncing..."
& rsync -avz --delete `
  --exclude node_modules `
  --exclude .next `
  --exclude .git `
  --exclude uploads `
  --exclude "*.log" `
  --exclude .env.local `
  "$RepoRoot/" "${VPS_USER}@${VPS_HOST}:${VPS_PATH}/"

Write-Host ""
Write-Host "Starting on VPS..."

if ($Build) {
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && docker compose build && docker compose up -d"
} else {
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && docker compose up -d"
}

Write-Host ""
Write-Host "Done. Check: https://dyskiof.net"
