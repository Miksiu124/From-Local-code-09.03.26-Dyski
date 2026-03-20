# Deploy avatars-cdn Worker do Cloudflare
# Wymaga: wrangler login LUB CLOUDFLARE_API_TOKEN w env
# Strefa dyskiof.net musi być w tym samym koncie Cloudflare co bucket R2 "files"

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== avatars-cdn Worker deploy ===" -ForegroundColor Cyan
Write-Host ""

# Sprawdź czy wrangler jest zalogowany
$whoami = npx wrangler whoami 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Wrangler nie jest zalogowany. Uruchom:" -ForegroundColor Yellow
    Write-Host "  npx wrangler login" -ForegroundColor White
    Write-Host ""
    Write-Host "Lub ustaw CLOUDFLARE_API_TOKEN w zmiennych środowiskowych." -ForegroundColor Yellow
    exit 1
}

Write-Host "Deployuję Worker..." -ForegroundColor Green
npx wrangler deploy

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Gotowe. Worker dostępny pod: https://files.dyskiof.net" -ForegroundColor Green
    Write-Host "Tylko ścieżki avatars/* są dozwolone — reszta zwraca 403." -ForegroundColor Gray
}
