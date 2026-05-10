# Uruchom setup VPS (SSH) — wymaga wpisania hasła, jeśli używasz hasła do konta
# Użycie:  $env:VPS_HOST = "serwer.lub.adres.ip";  .\scripts\run-vps-setup.ps1
# Opcjonalnie: $env:VPS_USER = "root"

$vpsHost = if ($env:VPS_HOST) { $env:VPS_HOST } else { $null }
if (-not $vpsHost) {
    Write-Host "Ustaw VPS_HOST, np. `$env:VPS_HOST = 'twoj.serwer'" -ForegroundColor Red
    exit 1
}
$vpsUser = if ($env:VPS_USER) { $env:VPS_USER } else { "root" }

$scriptPath = Join-Path $PSScriptRoot "vps-new-migration-setup.sh"
if (-not (Test-Path $scriptPath)) {
    Write-Host "Błąd: Nie znaleziono vps-new-migration-setup.sh" -ForegroundColor Red
    exit 1
}

Write-Host "Łączę z ${vpsUser}@${vpsHost} (wpisz hasło, jeśli wymagane)" -ForegroundColor Cyan
Write-Host ""

Get-Content $scriptPath -Raw | ssh -o StrictHostKeyChecking=no "${vpsUser}@${vpsHost}" "bash -s"
