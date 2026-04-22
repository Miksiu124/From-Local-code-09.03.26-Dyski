# Dyskiof — deploy na VPS (PowerShell)
# Konfiguracja polaczenia: ContentManager/.env.deploy (VPS_HOST, VPS_USER, VPS_PATH) — wczytywane automatycznie.
# Uzycie: .\scripts\deploy-vps.ps1 [-Pull] [-Build] [-Rebuild] [-RebuildFresh] [-PgUpgrade] [-Billionmail] [-Lgtm]
#   -Pull        = zamiast rsync/tar: na VPS git pull (wymaga repo + remote GitHub); gałąź: $env:GIT_BRANCH lub main
#   -Build       = sync + docker compose build + up
#   -Rebuild     = sync + pelna przebudowa od zera (zachowuje tylko postgres_data)
#   -RebuildFresh = sync + przebudowa OD ZERA z baza (zachowuje 4 uzytkownikow + .env)
#   -PgUpgrade   = sync + upgrade PostgreSQL 16→18 (backup-first, zero utraty danych)
#   -Billionmail = uzyj docker-compose.billionmail.yml
#   -Lgtm         = grafana/otel-lgtm (+ docker-compose.lgtm.yml); na pierwszym runie tworzy .env.lgtm z example, jesli brak
# Wymaga: rsync (z Git Bash lub WSL) albo uzyj scp

param([switch]$Pull, [switch]$Build, [switch]$Rebuild, [switch]$RebuildFresh, [switch]$PgUpgrade, [switch]$PgResume, [switch]$Billionmail, [switch]$Lgtm)

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

$GIT_BRANCH = if ($env:GIT_BRANCH) { $env:GIT_BRANCH } else { "main" }

Write-Host "=== Dyskiof deploy ==="
Write-Host "Host: $VPS_USER@$VPS_HOST`:$VPS_PATH"
if ($Pull) { Write-Host "Tryb: git pull na VPS (branch: $GIT_BRANCH, bez rsync/tar)" }
if ($PgUpgrade) { Write-Host "Tryb: UPGRADE PostgreSQL 16→18 (backup-first, zero utraty danych)" }
if ($PgResume) { Write-Host "Tryb: UPGRADE --resume (kontynuuj od restore)" }
if ($Lgtm) { Write-Host "LGTM: docker-compose.lgtm.yml (Grafana + OTel + Loki + Tempo)" }
Write-Host ""

function Sync-WithTarScp {
  Write-Host "Syncing (tar+scp, bez .env)..."
  $archive = Join-Path $env:TEMP "contentvault-deploy.tar"
  $remoteTar = "$VPS_PATH/contentvault-deploy.tar"
  Push-Location $RepoRoot
  tar -cf $archive --exclude=node_modules --exclude=.next --exclude=.git --exclude=uploads --exclude="*.log" --exclude=.env --exclude=.env.local .
  Pop-Location
  if ($LASTEXITCODE -ne 0) {
    Remove-Item $archive -ErrorAction SilentlyContinue
    Write-Error "tar archiwum nie powiodl sie (kod: $LASTEXITCODE)."
    exit $LASTEXITCODE
  }
  scp $archive "${VPS_USER}@${VPS_HOST}:$remoteTar"
  if ($LASTEXITCODE -ne 0) {
    Remove-Item $archive -ErrorAction SilentlyContinue
    Write-Error "scp nie powiodl sie (ostatni kod: $LASTEXITCODE). Sprawdz SSH i $remoteTar na VPS."
    exit $LASTEXITCODE
  }
  Remove-Item $archive -ErrorAction SilentlyContinue
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && tar xf contentvault-deploy.tar --no-same-owner --no-same-permissions && rm -f contentvault-deploy.tar"
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Rozpakowanie archiwum na VPS nie powiodlo sie."
    exit $LASTEXITCODE
  }
}

if ($Pull) {
  Write-Host "Git pull on VPS ($GIT_BRANCH)..."
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && git fetch origin && git checkout $GIT_BRANCH && git pull --ff-only origin $GIT_BRANCH"
  if ($LASTEXITCODE -ne 0) {
    Write-Error "git pull na VPS nie powiodl sie (sprawdz .git, remote, deploy key)."
    exit $LASTEXITCODE
  }
} else {
  # Sync: rsync (szybkie) lub tar+scp; cwRsync vs rsync 3.2 na Ubuntu czesto daje blad protokolu — wtedy fallback
  # cwRsync (Windows): lokalna sciezka /cygdrive/x/...
  $rsync = Get-Command rsync -ErrorAction SilentlyContinue
  $syncOk = $false
  if ($rsync) {
    Write-Host "Syncing (rsync)..."
    $localSrc = ($RepoRoot -replace '[\\/]+$', '')
    if ($localSrc -match '^([A-Za-z]):') {
      $drive = $Matches[1].ToLower()
      $tail = ($localSrc.Substring(2) -replace '\\', '/').TrimStart('/')
      $localSrc = "/cygdrive/$drive/$tail"
    } else {
      $localSrc = $localSrc -replace '\\', '/'
    }
    & rsync -avz --delete `
    --exclude node_modules `
    --exclude .next `
    --exclude .git `
    --exclude uploads `
    --exclude "*.log" `
    --exclude .env `
    --exclude .env.local `
    "$localSrc/" "${VPS_USER}@${VPS_HOST}:${VPS_PATH}/"
    if ($LASTEXITCODE -eq 0) {
      $syncOk = $true
    } else {
      Write-Host "rsync zwrocil kod $LASTEXITCODE - przelaczam na tar+scp."
    }
  } else {
    Write-Host "Brak rsync w PATH."
  }

  if (-not $syncOk) {
    Sync-WithTarScp
  }
}

Write-Host ""
Write-Host "Starting on VPS..."

$composeFiles = "-f docker-compose.yml -f docker-compose.vps.yml"
if ($Billionmail) { $composeFiles = "-f docker-compose.yml -f docker-compose.billionmail.yml -f docker-compose.vps.yml" }
if ($Lgtm) { $composeFiles = "$composeFiles -f docker-compose.lgtm.yml" }

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
  $preLgtm = if ($Lgtm) { "([ -f .env.lgtm ] || cp .env.lgtm.example .env.lgtm) && " } else { "" }
  # Po sync tar/rsync: bind-mount nginx.conf mogl wskazywac stary inode pliku --force-recreate nginx
  $postNginx = "docker compose $composeFiles up -d --no-deps --force-recreate nginx 2>/dev/null || true"
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && $preLgtm docker compose $composeFiles build && docker compose $composeFiles up -d && $postNginx"
} else {
  $preLgtm = if ($Lgtm) { "([ -f .env.lgtm ] || cp .env.lgtm.example .env.lgtm) && " } else { "" }
  $postNginx = "docker compose $composeFiles up -d --no-deps --force-recreate nginx 2>/dev/null || true"
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && $preLgtm docker compose $composeFiles up -d && $postNginx"
}

Write-Host ""
Write-Host "Done. Check: https://dyskiof.net"
