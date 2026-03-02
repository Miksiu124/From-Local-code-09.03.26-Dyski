# Cloudflare Zone Audit - dyskiof.net
# Uruchom: .\scripts\cloudflare-audit.ps1
# Wymaga: cloudflare.env z CLOUDFLARE_API_TOKEN

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# Load token
$envFile = Join-Path $projectRoot "cloudflare.env"
if (-not (Test-Path $envFile)) {
    Write-Host "Brak cloudflare.env. Skopiuj cloudflare.env.example i wklej token." -ForegroundColor Red
    exit 1
}
Get-Content $envFile | ForEach-Object {
    if ($_ -match "^CLOUDFLARE_API_TOKEN=(.+)$") {
        $script:token = $Matches[1].Trim()
    }
}
if (-not $script:token -or $script:token -eq "YOUR_TOKEN_HERE") {
    Write-Host "Ustaw CLOUDFLARE_API_TOKEN w cloudflare.env" -ForegroundColor Red
    exit 1
}

$zoneId = "57ceda9259f1056d966a60c25a9790de"
$headers = @{
    "Authorization" = "Bearer $script:token"
    "Content-Type"  = "application/json"
}

Write-Host "`n=== Cloudflare Audit: dyskiof.net ===`n" -ForegroundColor Cyan

# Zone
$zone = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId" -Headers $headers -Method Get
Write-Host "Zone: $($zone.result.name) | Plan: $($zone.result.plan.name) | Status: $($zone.result.status)" -ForegroundColor Green

# DNS
$dns = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records" -Headers $headers -Method Get
$proxied = $dns.result | Where-Object { $_.proxied -eq $true }
Write-Host "`nDNS: $($dns.result.Count) rekordow | Proxied (orange cloud): $($proxied.Count)" -ForegroundColor $(if ($proxied.Count -gt 0) { "Green" } else { "Yellow" })

# SSL
$ssl = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/settings/ssl" -Headers $headers -Method Get
Write-Host "SSL: $($ssl.result.value) | Cert: $($ssl.result.certificate_status)" -ForegroundColor Green

# Security
$sec = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/settings/security_level" -Headers $headers -Method Get
$tls = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/settings/min_tls_version" -Headers $headers -Method Get
$https = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/settings/always_use_https" -Headers $headers -Method Get
Write-Host "`nSecurity Level: $($sec.result.value) | Min TLS: $($tls.result.value) | Always HTTPS: $($https.result.value)" -ForegroundColor Green

Write-Host "`n=== Koniec audytu ===`n" -ForegroundColor Cyan
