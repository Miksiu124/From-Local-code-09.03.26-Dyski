# Load test + monitor VPS - uruchamia test i jednoczesnie loguje docker stats
# Uzycie: .\scripts\load-test-with-monitor.ps1 -Streams 500 -Duration 90

param(
    [string]$Cookie = "YOUR_JWT_TOKEN_HERE",
    [string]$ContentId = "bec32564-3d1c-4d4e-aa9f-8605ee87d98d",
    [int]$Streams = 500,
    [int]$Duration = 90,
    [string]$VpsHost = "138.249.138.60",
    [string]$VpsUser = "deploy"
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$statsFile = Join-Path $env:TEMP "docker-stats-loadtest-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt"

Write-Host "=== Load test + VPS monitor ===" -ForegroundColor Cyan
Write-Host "Streamy: $Streams | Czas: ${Duration}s | Monitor: docker stats co 3s" -ForegroundColor Cyan
Write-Host ""

# 1. Uruchom docker stats na VPS w tle (zapis do pliku)
Write-Host "[1] Uruchamiam monitor docker stats na VPS..." -ForegroundColor Yellow
$monitorJob = Start-Job -ScriptBlock {
    param($host, $user, $outFile)
    $duration = 120
    $end = [DateTime]::Now.AddSeconds($duration)
    while ([DateTime]::Now -lt $end) {
        $result = ssh "${user}@${host}" "cd /opt/contentvault && docker stats --no-stream 2>/dev/null"
        $timestamp = Get-Date -Format "HH:mm:ss"
        Add-Content -Path $outFile -Value "`n=== $timestamp ===`n$result"
        Start-Sleep -Seconds 3
    }
} -ArgumentList $VpsHost, $VpsUser, $statsFile

Start-Sleep -Seconds 2

# 2. Uruchom load test
Write-Host "[2] Uruchamiam load test ($Streams streamow, ${Duration}s)..." -ForegroundColor Yellow
$testJob = Start-Job -ScriptBlock {
    param($root, $cookie, $contentId, $streams, $duration)
    Set-Location $root
    & py -3.13 scripts/load-test-streams.py --cookie $cookie --content-id $contentId --streams $streams --duration $duration 2>&1
} -ArgumentList $projectRoot, $Cookie, $ContentId, $Streams, $Duration

# 3. Czekaj na zakonczenie testu
$testOutput = Wait-Job $testJob | Receive-Job
Write-Host $testOutput

# 4. Zatrzymaj monitor (poczekaj chwile jesli jeszcze dziala)
Start-Sleep -Seconds 5
Stop-Job $monitorJob -ErrorAction SilentlyContinue
Remove-Job $monitorJob -Force -ErrorAction SilentlyContinue

# 5. Wyswietl zebrane statystyki
Write-Host ""
Write-Host "=== Docker stats (co 3s podczas testu) ===" -ForegroundColor Cyan
if (Test-Path $statsFile) {
    Get-Content $statsFile
    Write-Host ""
    Write-Host "Pelny log: $statsFile" -ForegroundColor Gray
} else {
    Write-Host "Brak pliku - sprawdz polaczenie SSH deploy@$VpsHost" -ForegroundColor Red
}
