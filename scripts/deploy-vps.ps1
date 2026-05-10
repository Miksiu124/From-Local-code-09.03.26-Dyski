# Dyskiof — deploy na VPS (PowerShell)
# Konfiguracja polaczenia: ContentManager/.env.deploy (VPS_HOST, VPS_USER, VPS_PATH) — wczytywane automatycznie.
# Uzycie: .\scripts\deploy-vps.ps1 [-Pull] [-Build] [-Rebuild] [-RebuildFresh] [-PgUpgrade] [-Lgtm]
#   -Pull        = zamiast rsync/tar: na VPS git pull (wymaga repo + remote GitHub); gałąź: $env:GIT_BRANCH lub main
#   -Build       = sync + docker compose build + up
#   -Rebuild     = sync + pelna przebudowa od zera (zachowuje tylko postgres_data)
#   -RebuildFresh = sync + przebudowa OD ZERA z baza (zachowuje 4 uzytkownikow + .env)
#   -PgUpgrade   = sync + upgrade PostgreSQL 16→18 (backup-first, zero utraty danych)
#   -Lgtm         = grafana/otel-lgtm (+ docker-compose.lgtm.yml); na pierwszym runie tworzy .env.lgtm z example, jesli brak
# Wymaga: rsync (z Git Bash lub WSL) albo uzyj scp
# Wolumen produkcyjny: docker-compose.use3566349.yml (contentvault_postgres_cluster).
#   Źródła (kolejność): .env.deploy → lokalne .env.vps → $VPS_PATH/.env.vps na serwerze → zmienna procesu (CI) → 0
#   Na VPS skopiuj .env.vps.example → /opt/contentvault/.env.vps, aby git pull/CI nigdy nie traciły flagi.

param([switch]$Pull, [switch]$Build, [switch]$Rebuild, [switch]$RebuildFresh, [switch]$PgUpgrade, [switch]$PgResume, [switch]$Lgtm)

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

function Get-DotenvKey {
  param([string]$Path, [string]$Key)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*([^#=]+)=(.*)$' -and $matches[1].Trim()) {
      if ($matches[1].Trim() -eq $Key) { return ($matches[2].Trim() -replace "`r`$", '') }
    }
  }
  return $null
}

$pgcResolved = Get-DotenvKey $deployEnv "VPS_USE_POSTGRES_CLUSTER"
if ($null -eq $pgcResolved) {
  $pgcResolved = Get-DotenvKey (Join-Path $RepoRoot ".env.vps") "VPS_USE_POSTGRES_CLUSTER"
}
if ($null -eq $pgcResolved -and $VPS_HOST) {
  $rf = "$VPS_PATH/.env.vps"
  try {
    $remoteLine = & ssh -o BatchMode=yes -o ConnectTimeout=8 "${VPS_USER}@${VPS_HOST}" "test -f `"$rf`" && grep -E '^[[:space:]]*VPS_USE_POSTGRES_CLUSTER[[:space:]]*=' `"$rf`" 2>/dev/null | head -1" 2>$null
    if ($remoteLine -match '^\s*VPS_USE_POSTGRES_CLUSTER\s*=\s*(.*)$') {
      $pgcResolved = $matches[1].Trim() -replace "`r`$", ''
    }
  } catch { }
}
if ($null -eq $pgcResolved) {
  $x = [string]$env:VPS_USE_POSTGRES_CLUSTER
  if (-not [string]::IsNullOrWhiteSpace($x)) { $pgcResolved = $x }
}
if ($null -eq $pgcResolved) { $pgcResolved = "0" }

$usePostgresCluster = ($pgcResolved -eq "1" -or $pgcResolved -ieq "true" -or $pgcResolved -ieq "yes")
[Environment]::SetEnvironmentVariable("VPS_USE_POSTGRES_CLUSTER", $pgcResolved, "Process")

Write-Host "=== Dyskiof deploy ==="
Write-Host "Host: $VPS_USER@$VPS_HOST`:$VPS_PATH"
if ($Pull) { Write-Host "Tryb: git pull na VPS (branch: $GIT_BRANCH, bez rsync/tar)" }
if ($PgUpgrade) { Write-Host "Tryb: UPGRADE PostgreSQL 16->18 (backup-first, zero utraty danych)" }
if ($PgResume) { Write-Host "Tryb: UPGRADE --resume (kontynuuj od restore)" }
if ($Lgtm) { Write-Host "LGTM: docker-compose.lgtm.yml (Grafana + OTel + Loki + Tempo)" }
if ($usePostgresCluster) { Write-Host "Postgres: docker-compose.use3566349.yml (wolumen klastra)" }
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
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && tar xf contentvault-deploy.tar --no-same-owner --no-same-permissions && rm -f contentvault-deploy.tar && rm -rf saasmail && rm -f backend/internal/mailer/cloudflare.go"
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

# Zgodnie z deploy-vps.sh: lista plików compose na serwerze (scripts/compose-vps-files.sh)
$lgtmF = if ($Lgtm) { " --lgtm" } else { "" }
$remotePre = "cd $VPS_PATH && sed -i 's/\r`$//' scripts/compose-vps-files.sh 2>/dev/null; source scripts/compose-vps-files.sh && set_compose_vps_files$lgtmF && " +
  'if [[ "$COMPOSE_FILES" == *lgtm.yml* ]] && [ ! -f .env.lgtm ]; then cp .env.lgtm.example .env.lgtm; fi && '

if ($RebuildFresh) {
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && sed -i 's/`r`$//' scripts/vps-rebuild-fresh.sh 2>/dev/null; bash scripts/vps-rebuild-fresh.sh$lgtmF"
} elseif ($Rebuild) {
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && bash scripts/vps-rebuild.sh$lgtmF"
} elseif ($PgUpgrade) {
  $resumeArg = if ($PgResume) { " --resume" } else { "" }
  ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && bash scripts/upgrade-postgres-16-to-18.sh$resumeArg$lgtmF"
} elseif ($Build) {
  $remoteTail = 'docker compose $COMPOSE_FILES build && docker compose $COMPOSE_FILES up -d && (docker compose $COMPOSE_FILES up -d --no-deps --force-recreate nginx 2>/dev/null || true)'
  $remoteSsh = $remotePre + $remoteTail
  ssh "${VPS_USER}@${VPS_HOST}" "$remoteSsh"
} else {
  $remoteTail = 'docker compose $COMPOSE_FILES up -d && (docker compose $COMPOSE_FILES up -d --no-deps --force-recreate nginx 2>/dev/null || true)'
  $remoteSsh = $remotePre + $remoteTail
  ssh "${VPS_USER}@${VPS_HOST}" "$remoteSsh"
}

# Weryfikacja wolumenu Postgres (tylko po zwykłym compose up; skrypty rebuild/upgrade same pilnują danych)
$runPgVerify = (-not $Rebuild) -and (-not $RebuildFresh) -and (-not $PgUpgrade)
if ($runPgVerify -and $LASTEXITCODE -eq 0) {
  if ($usePostgresCluster) {
    $mounts = ssh -o BatchMode=yes -o ConnectTimeout=8 "${VPS_USER}@${VPS_HOST}" "docker inspect -f '{{range .Mounts}}{{.Name}};{{end}}' content-postgres 2>/dev/null" 2>$null
    if ($mounts -notmatch 'contentvault_postgres_cluster') {
      Write-Error "Postgres: oczekiwano wolumenu contentvault_postgres_cluster; montaż: '$mounts'. Ustaw lokalnie VPS_USE_POSTGRES_CLUSTER=1 w .env.deploy albo skopiuj .env.vps.example na serwer do $VPS_PATH/.env.vps i wdróż ponownie."
      exit 1
    }
    Write-Host "Postgres: OK (wolumen klastra)." -ForegroundColor Green
  } elseif ($VPS_PATH -eq '/opt/contentvault') {
    Write-Warning "Postgres: tryb domyslny (postgres_data), nie wolumen klastra. Jesli na produkcji brak sesji / uzytkownikow, ustaw VPS_USE_POSTGRES_CLUSTER=1 albo $VPS_PATH/.env.vps - patrz .env.vps.example"
  }
}

Write-Host ""
Write-Host "Done. Check: https://dyskiof.net"
