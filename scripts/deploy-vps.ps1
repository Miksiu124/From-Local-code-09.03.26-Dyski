# ContentVault — deploy na VPS (PowerShell)
# Konfiguracja polaczenia: ContentManager/.env.deploy (VPS_HOST, VPS_USER, VPS_PATH) — wczytywane automatycznie.
# Uzycie: .\scripts\deploy-vps.ps1 [-Build] [-Rebuild] [-RebuildFresh] [-PgUpgrade] [-Billionmail]
#   -Build       = sync + docker compose build + up
#   -Rebuild     = sync + pelna przebudowa od zera (zachowuje tylko postgres_data)
#   -RebuildFresh = sync + przebudowa OD ZERA z baza (zachowuje 4 uzytkownikow + .env)
#   -PgUpgrade   = sync + upgrade PostgreSQL 16→18 (backup-first, zero utraty danych)
#   -Billionmail = uzyj docker-compose.billionmail.yml
# Wymaga: rsync (z Git Bash lub WSL) albo uzyj scp

param([switch]$Build, [switch]$Rebuild, [switch]$RebuildFresh, [switch]$PgUpgrade, [switch]$PgResume, [switch]$Billionmail)

# Laduj .env.deploy jesli istnieje
$deployEnv = Join-Path (Split-Path -Parent $PSScriptRoot) ".env.deploy"
if (Test-Path $deployEnv) {
  Get-Content $deployEnv | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$' -and $matches[1].Trim()) {
      $val = $matches[2].Trim() -replace "`r`$", ''
      [Environment]::SetEnvironmentVariable($matches[1].Trim(), $val, 'Process')
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
if ($PgUpgrade) { Write-Host "Tryb: UPGRADE PostgreSQL 16→18 (backup-first, zero utraty danych)" }
if ($PgResume) { Write-Host "Tryb: UPGRADE --resume (kontynuuj od restore)" }
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
  $remoteTar = "$VPS_PATH/contentvault-deploy.tar"
  Push-Location $RepoRoot
  tar -cf $archive --exclude=node_modules --exclude=.next --exclude=.git --exclude=uploads --exclude="*.log" --exclude=.env --exclude=.env.local .
  Pop-Location
  scp $archive "${VPS_USER}@${VPS_HOST}:$remoteTar"
  if ($LASTEXITCODE -ne 0) {
    Remove-Item $archive -ErrorAction SilentlyContinue
    Write-Error "scp nie powiodl sie (ostatni kod: $LASTEXITCODE). Zainstaluj rsync (np. Git for Windows) albo sprawdz prawa do $remoteTar na VPS."
    exit $LASTEXITCODE
  }
  Remove-Item $archive -ErrorAction SilentlyContinue
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && tar xf contentvault-deploy.tar --no-same-owner --no-same-permissions && rm -f contentvault-deploy.tar"
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Rozpakowanie archiwum na VPS nie powiodlo sie."
    exit $LASTEXITCODE
  }
}

Write-Host ""
Write-Host "Starting on VPS..."

$composeFiles = "-f docker-compose.yml -f docker-compose.vps.yml"
if ($Billionmail) { $composeFiles = "-f docker-compose.yml -f docker-compose.billionmail.yml -f docker-compose.vps.yml" }

if ($RebuildFresh) {
  $bmArg = if ($Billionmail) { " --billionmail" } else { "" }
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && sed -i 's/`r`$//' scripts/vps-rebuild-fresh.sh 2>/dev/null; bash scripts/vps-rebuild-fresh.sh$bmArg"
} elseif ($Rebuild) {
  $bmArg = if ($Billionmail) { " --billionmail" } else { "" }
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && bash scripts/vps-rebuild.sh$bmArg"
} elseif ($PgUpgrade) {
  $bmArg = if ($Billionmail) { " --billionmail" } else { "" }
  $resumeArg = if ($PgResume) { " --resume " } else { "" }
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && bash scripts/upgrade-postgres-16-to-18.sh${resumeArg}$bmArg"
} elseif ($Build) {
  # Po recreate frontend/api nginx może trzymać stare IP upstream — reload nginx po up (obeszło też przed poprawką resolver w nginx.conf.production)
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && docker compose $composeFiles build && docker compose $composeFiles up -d && docker compose $composeFiles exec -T nginx nginx -s reload 2>/dev/null || docker compose $composeFiles restart nginx"
} else {
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && docker compose $composeFiles up -d"
}

Write-Host ""
Write-Host "Done. Check: https://dyskiof.net"
