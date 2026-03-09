# Uruchom setup VPS na nowym serwerze
# Wymaga: haslo root (wpisz gdy zostaniesz poproszony)
# Uzycie: .\scripts\run-vps-setup.ps1

$vpsIp = "138.249.138.60"
$scriptPath = Join-Path $PSScriptRoot "vps-new-migration-setup.sh"

if (-not (Test-Path $scriptPath)) {
    Write-Host "Blad: Nie znaleziono vps-new-migration-setup.sh" -ForegroundColor Red
    exit 1
}

Write-Host "Lacze z root@$vpsIp - wpisz haslo gdy zostaniesz poproszony" -ForegroundColor Cyan
Write-Host ""

# Wysylamy skrypt przez SSH (pipe)
Get-Content $scriptPath -Raw | ssh -o StrictHostKeyChecking=no root@$vpsIp "bash -s"
