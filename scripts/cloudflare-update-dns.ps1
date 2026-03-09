# Cloudflare DNS - Update A record for dyskiof.net to new origin IP
# Uruchom: .\scripts\cloudflare-update-dns.ps1 -NewIP "138.249.138.60"
# Wymaga: cloudflare.env z CLOUDFLARE_API_TOKEN

param(
    [string]$NewIP = "138.249.138.60"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$envFile = Join-Path $projectRoot "cloudflare.env"

if (-not (Test-Path $envFile)) {
    Write-Host "Brak cloudflare.env. Skopiuj cloudflare.env.example i wklej token." -ForegroundColor Red
    exit 1
}

$token = $null
Get-Content $envFile | ForEach-Object {
    if ($_ -match "^CLOUDFLARE_API_TOKEN=(.+)$") {
        $token = $Matches[1].Trim()
    }
}
if (-not $token -or $token -eq "YOUR_TOKEN_HERE") {
    Write-Host "Ustaw CLOUDFLARE_API_TOKEN w cloudflare.env" -ForegroundColor Red
    exit 1
}

$zoneId = "57ceda9259f1056d966a60c25a9790de"
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json"
}

Write-Host "`n=== Cloudflare DNS Update: dyskiof.net -> $NewIP (Proxied) ===`n" -ForegroundColor Cyan

# Get current DNS records
$dns = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records" -Headers $headers -Method Get
$arecord = $dns.result | Where-Object { $_.type -eq "A" -and $_.name -eq "dyskiof.net" }

if (-not $arecord) {
    Write-Host "Rekord A dla dyskiof.net nie znaleziony. Tworzę nowy..." -ForegroundColor Yellow
    $body = @{
        type = "A"
        name = "dyskiof.net"
        content = $NewIP
        ttl = 1
        proxied = $true
    } | ConvertTo-Json
    $result = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records" -Headers $headers -Method Post -Body $body
    Write-Host "Utworzono rekord A: dyskiof.net -> $NewIP (Proxied)" -ForegroundColor Green
} else {
    if ($arecord.content -eq $NewIP -and $arecord.proxied -eq $true) {
        Write-Host "Rekord A już ustawiony: dyskiof.net -> $NewIP (Proxied)" -ForegroundColor Green
    } else {
        $recordId = $arecord.id
        $body = @{
            type = "A"
            name = "dyskiof.net"
            content = $NewIP
            ttl = 1
            proxied = $true
        } | ConvertTo-Json
        Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records/$recordId" -Headers $headers -Method Put -Body $body | Out-Null
        Write-Host "Zaktualizowano rekord A: dyskiof.net -> $NewIP (Proxied)" -ForegroundColor Green
    }
}

Write-Host "`nWeryfikacja: dig dyskiof.net +short (powinno zwrócić IP Cloudflare, NIE $NewIP)" -ForegroundColor Cyan
Write-Host ""
