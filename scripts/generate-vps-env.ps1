# Generuje .env dla nowego VPS (nowe secrety + dane ze starego)
# Uruchom: .\scripts\generate-vps-env.ps1
# Wynik: .env.vps.new (skopiuj na VPS jako .env)

param(
    [string]$OutputPath = ".\.env.vps.new"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$envFile = Join-Path $projectRoot ".env"

if (-not (Test-Path $envFile)) {
    Write-Host "Brak .env - skopiuj .env.production.example i uzupelnij" -ForegroundColor Red
    exit 1
}

# Wczytaj stare wartosci (R2, Discord, Redis, Admin, SMTP)
$oldEnv = @{}
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') {
        $oldEnv[$Matches[1].Trim()] = $Matches[2].Trim()
    }
}

# Generuj nowe secrety
$jwtSecret = -join ((1..64) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
$streamSecret = -join ((1..64) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
$authSecret = -join ((1..64) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
$chars = [char[]]'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
$pgPassword = -join (1..40 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })

# SMTP - produkcja uzywa Resend relay; jesli brak w starym, placeholder
$smtpRelay = $oldEnv['SMTP_RELAY_PASSWORD']
if (-not $smtpRelay) { $smtpRelay = "PASTE_RESEND_API_KEY_FROM_OLD_VPS" }

$content = @"
# ContentVault - Production (new VPS 138.249.138.60)
# Wygenerowano: $(Get-Date -Format 'yyyy-MM-dd HH:mm')

ENVIRONMENT=production
PORT=8080
FRONTEND_URL=https://dyskiof.net
API_URL=http://api:8080/api

POSTGRES_PASSWORD=$pgPassword
DATABASE_URL=postgresql://platform:$pgPassword@postgres:5432/content_platform?sslmode=disable

REDIS_URL=redis://redis:6379

JWT_SECRET=$jwtSecret
JWT_EXPIRY_SECS=2592000
SESSION_TOKEN_TTL=2592000

AUTH_SECRET=$authSecret
AUTH_URL=https://dyskiof.net

R2_ACCOUNT_ID=$($oldEnv['R2_ACCOUNT_ID'])
R2_ACCESS_KEY_ID=$($oldEnv['R2_ACCESS_KEY_ID'])
R2_SECRET_ACCESS_KEY=$($oldEnv['R2_SECRET_ACCESS_KEY'])
R2_BUCKET_NAME=$($oldEnv['R2_BUCKET_NAME'])
R2_ENDPOINT=$($oldEnv['R2_ENDPOINT'])

STREAMING_TOKEN_SECRET=$streamSecret
STREAMING_TOKEN_TTL=21600

DISCORD_CLIENT_ID=$($oldEnv['DISCORD_CLIENT_ID'])
DISCORD_CLIENT_SECRET=$($oldEnv['DISCORD_CLIENT_SECRET'])
DISCORD_REDIRECT_URI=https://dyskiof.net/api/auth/discord/callback

ADMIN_EMAILS=$($oldEnv['ADMIN_EMAILS'])

BLIK_EXPIRATION_MINUTES=2

SMTP_HOST=smtp
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@dyskiof.net
SMTP_RELAYHOST=[smtp.resend.com]:587
SMTP_RELAY_USERNAME=resend
SMTP_RELAY_PASSWORD=$smtpRelay
SMTP_HOSTNAME=mail.dyskiof.net
SMTP_ALLOWED_DOMAINS=dyskiof.net

NGINX_CONFIG=./nginx/nginx.conf.production
NEXT_PUBLIC_APP_URL=https://dyskiof.net
"@

$outPath = Join-Path $projectRoot (Split-Path $OutputPath -Leaf)
$content | Out-File -FilePath $outPath -Encoding utf8
Write-Host "Wygenerowano: $outPath" -ForegroundColor Green
Write-Host "Skopiuj na VPS: scp .env.vps.new deploy@138.249.138.60:/opt/contentvault/.env" -ForegroundColor Cyan
