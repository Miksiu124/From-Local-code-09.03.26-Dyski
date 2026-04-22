# Run pending SQL migrations on existing PostgreSQL database.
# Use when the DB was created before new migrations were added (initdb.d only runs on first init).
#
# Usage: .\scripts\run-pending-migrations.ps1
# Docker: docker exec -i content-postgres psql -U platform -d content_platform < backend/migrations/20260313120000_add_referral_link_tracking.up.sql

$ErrorActionPreference = "Stop"
$ContentDir = Split-Path -Parent $PSScriptRoot
Set-Location $ContentDir

# Load .env
if (Test-Path .env) {
    Get-Content .env | ForEach-Object {
        if ($_ -match '^([^#=]+)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
        }
    }
}

$dbHost = if ($env:POSTGRES_HOST) { $env:POSTGRES_HOST } else { "localhost" }
$dbPort = if ($env:POSTGRES_PORT) { $env:POSTGRES_PORT } else { "5432" }
$dbName = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "content_platform" }
$dbUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "platform" }
$dbPass = $env:POSTGRES_PASSWORD
if ($env:DATABASE_URL -match 'postgresql://([^:]+):([^@]+)@([^:]+):([0-9]+)/([^?]+)') {
    $dbUser = $matches[1]
    $dbPass = $matches[2]
    $dbHost = $matches[3]
    $dbPort = $matches[4]
    $dbName = $matches[5]
}
if (-not $dbPass) { Write-Error "POSTGRES_PASSWORD or DATABASE_URL required"; exit 1 }

$migrationFile = Join-Path $ContentDir "backend\migrations\20260313120000_add_referral_link_tracking.up.sql"

Write-Host "=========================================="
Write-Host "Dyskiof - Pending Migrations"
Write-Host "=========================================="

$env:PGPASSWORD = $dbPass

# Check custom_links (required for admin custom links feature)
$checkCustomLinks = & psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -tAc "SELECT 1 FROM information_schema.tables WHERE table_name='custom_links'" 2>$null
if ($checkCustomLinks -notmatch "1") {
    Write-Host "[Pending] custom_links missing - applying 20260305223600 and 20260305234500..."
    $m1 = Join-Path $ContentDir "backend\migrations\20260305223600_add_custom_links.up.sql"
    $m2 = Join-Path $ContentDir "backend\migrations\20260305234500_track_link_conversions.up.sql"
    & psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -v ON_ERROR_STOP=1 -f $m1 2>$null
    & psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -v ON_ERROR_STOP=1 -f $m2 2>$null
    Write-Host "  -> custom_links + link_visits ready"
}

# Check if referral_link_visits exists
$check = & psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -tAc "SELECT 1 FROM information_schema.tables WHERE table_name='referral_link_visits'" 2>$null
if ($check -match "1") {
    Write-Host "[OK] referral_link_visits table exists"
    exit 0
}

Write-Host "[Pending] referral_link_visits missing - applying 20260313120000..."
try {
    & psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -v ON_ERROR_STOP=1 -f $migrationFile
    Write-Host "  -> OK"
} catch {
    Write-Host "  -> Failed or already applied"
}

$check2 = & psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -tAc "SELECT 1 FROM information_schema.tables WHERE table_name='referral_link_visits'" 2>$null
if ($check2 -match "1") {
    Write-Host ""
    Write-Host "Done. referral_link_visits is ready. Referral clicks will now be tracked."
} else {
    Write-Host ""
    Write-Host "Warning: referral_link_visits still missing. Run manually:"
    Write-Host "  docker exec -i content-postgres psql -U platform -d content_platform < backend/migrations/20260313120000_add_referral_link_tracking.up.sql"
    exit 1
}
