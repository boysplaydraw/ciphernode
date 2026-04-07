# ============================================================
# CipherNode Relay — Windows Başlatma Scripti (PowerShell)
# Kullanım: powershell -ExecutionPolicy Bypass -File scripts\windows-start.ps1 [mod]
#   mod: server (varsayılan), ngrok, cloudflare, docker
#
# Kısa yol: sağ tıkla → "PowerShell ile çalıştır"
# ============================================================

param(
    [string]$Mode = "server",
    [string]$NgrokToken = "",
    [string]$DuckDomain = "",
    [string]$DuckToken = "",
    [int]$Port = 5000,
    [string]$SslDomain = ""
)

$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $PSScriptRoot

function Write-Header($text) {
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host " $text" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
}

function Check-NodeJs {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "[Hata] Node.js bulunamadi!" -ForegroundColor Red
        Write-Host "  Indirin: https://nodejs.org (LTS surum onerilir)"
        Write-Host "  veya: winget install OpenJS.NodeJS.LTS"
        exit 1
    }
    $ver = (node --version)
    Write-Host "[OK] Node.js: $ver" -ForegroundColor Green
}

function Build-Server {
    Set-Location $AppDir

    if (-not (Test-Path "node_modules")) {
        Write-Host "[setup] npm install caligturuluyor..." -ForegroundColor Yellow
        npm install
    }

    if (-not (Test-Path "server_dist")) {
        Write-Host "[setup] Sunucu derleniyor..." -ForegroundColor Yellow
        npm run server:build
    }
}

function Get-LocalIP {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 |
           Where-Object { $_.InterfaceAlias -notmatch "Loopback" -and $_.IPAddress -notmatch "^169" } |
           Select-Object -First 1).IPAddress
    return $ip
}

function Start-RelayServer($host_bind = "0.0.0.0") {
    $env:NODE_ENV = "production"
    $env:PORT = $Port
    $env:HOST = $host_bind
    $serverFile = if (Test-Path "$AppDir\server_dist\index.mjs") { "$AppDir\server_dist\index.mjs" } else { "$AppDir\server_dist\index.js" }
    $proc = Start-Process node -ArgumentList $serverFile -PassThru -NoNewWindow
    Start-Sleep -Seconds 2
    return $proc
}

# ── Hazırlık ───────────────────────────────────────────────
Check-NodeJs
Build-Server
$localIP = Get-LocalIP

switch ($Mode.ToLower()) {

    # ── Sadece sunucu ─────────────────────────────────────
    "server" {
        Write-Header "CipherNode Relay — Windows"
        Write-Host ""
        Write-Host " Yerel : http://localhost:$Port"
        if ($localIP) {
            Write-Host " LAN   : http://${localIP}:$Port"
        }
        Write-Host ""
        Write-Host " Dis agdan erisim icin:"
        Write-Host "   powershell -File scripts\windows-start.ps1 -Mode ngrok"
        Write-Host "   powershell -File scripts\windows-start.ps1 -Mode cloudflare"
        Write-Host "   powershell -File scripts\windows-start.ps1 -Mode docker"
        Write-Host ""
        Write-Host " Durdurmak icin Ctrl+C"
        Write-Host ""

        $env:NODE_ENV = "production"
        $env:PORT = $Port
        $env:HOST = "0.0.0.0"
        Set-Location $AppDir
        $serverFile = if (Test-Path "server_dist\index.mjs") { "server_dist\index.mjs" } else { "server_dist\index.js" }
        node $serverFile
    }

    # ── ngrok ─────────────────────────────────────────────
    "ngrok" {
        # ngrok kurulu mu?
        if (-not (Get-Command ngrok -ErrorAction SilentlyContinue)) {
            Write-Host "[ngrok] ngrok bulunamadi. Kuruluyor..." -ForegroundColor Yellow

            # winget ile dene
            if (Get-Command winget -ErrorAction SilentlyContinue) {
                winget install ngrok.ngrok --silent
            } else {
                # Manuel indirme
                $ngrokUrl = "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip"
                $zipPath = "$env:TEMP\ngrok.zip"
                Write-Host "[ngrok] Indiriliyor..." -ForegroundColor Yellow
                Invoke-WebRequest $ngrokUrl -OutFile $zipPath
                Expand-Archive $zipPath -DestinationPath "$env:LOCALAPPDATA\ngrok" -Force
                $env:PATH += ";$env:LOCALAPPDATA\ngrok"
                Write-Host "[ngrok] $env:LOCALAPPDATA\ngrok klasorunu PATH'e ekleyin"
            }
        }

        # Token ayarla
        if ($NgrokToken) {
            ngrok config add-authtoken $NgrokToken
        }

        # Sunucuyu baslat
        $server = Start-RelayServer
        Write-Host "[ngrok] Tunel aciliyor..." -ForegroundColor Yellow
        $ngrokProc = Start-Process ngrok -ArgumentList "http $Port" -PassThru -NoNewWindow
        Start-Sleep -Seconds 4

        # URL al
        try {
            $tunnels = Invoke-RestMethod "http://localhost:4040/api/tunnels" -ErrorAction SilentlyContinue
            $url = ($tunnels.tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1).public_url
        } catch {
            $url = $null
        }

        Write-Header "CipherNode + ngrok"
        if ($url) {
            Write-Host " Dis URL : $url" -ForegroundColor Green
            Write-Host ""
            Write-Host " Uygulamada:"
            Write-Host "   Ayarlar > Ag Ayarlari > Ozel Sunucu"
            Write-Host "   URL: $url"
        } else {
            Write-Host " URL: http://localhost:4040 adresine bakin" -ForegroundColor Yellow
        }
        Write-Host " ngrok UI: http://localhost:4040"
        Write-Host ""
        Write-Host " Durdurmak icin bu pencereyi kapatin"
        Write-Host ""

        Wait-Process -Id $ngrokProc.Id
        Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
    }

    # ── Cloudflare Tunnel ─────────────────────────────────
    "cloudflare" {
        if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
            Write-Host "[cloudflare] cloudflared bulunamadi. Kuruluyor..." -ForegroundColor Yellow
            if (Get-Command winget -ErrorAction SilentlyContinue) {
                winget install Cloudflare.cloudflared --silent
            } else {
                $cfUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
                $cfPath = "$env:LOCALAPPDATA\cloudflared\cloudflared.exe"
                New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\cloudflared" | Out-Null
                Write-Host "[cloudflare] Indiriliyor..." -ForegroundColor Yellow
                Invoke-WebRequest $cfUrl -OutFile $cfPath
                $env:PATH += ";$env:LOCALAPPDATA\cloudflared"
            }
        }

        $server = Start-RelayServer
        Write-Host "[cloudflare] Tunel aciliyor..." -ForegroundColor Yellow

        $logFile = "$env:TEMP\cf_tunnel.log"
        $cfProc = Start-Process cloudflared -ArgumentList "tunnel --url http://localhost:$Port" `
            -PassThru -NoNewWindow -RedirectStandardOutput $logFile -RedirectStandardError $logFile

        $cfUrl = $null
        for ($i = 0; $i -lt 15; $i++) {
            Start-Sleep -Seconds 1
            if (Test-Path $logFile) {
                $content = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
                if ($content -match "(https://[a-z0-9\-]+\.trycloudflare\.com)") {
                    $cfUrl = $Matches[1]
                    break
                }
            }
        }

        Write-Header "CipherNode + Cloudflare Tunnel"
        if ($cfUrl) {
            Write-Host " Dis URL : $cfUrl" -ForegroundColor Green
            Write-Host ""
            Write-Host " Uygulamada:"
            Write-Host "   Ayarlar > Ag Ayarlari > Ozel Sunucu"
            Write-Host "   URL: $cfUrl"
        } else {
            Write-Host " URL: $logFile dosyasina bakin" -ForegroundColor Yellow
        }
        Write-Host ""
        Write-Host " Durdurmak icin bu pencereyi kapatin"
        Write-Host ""

        Wait-Process -Id $cfProc.Id
        Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
    }

    # ── Docker ────────────────────────────────────────────
    "docker" {
        if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
            Write-Host "[docker] Docker bulunamadi!" -ForegroundColor Red
            Write-Host "  Docker Desktop indirin: https://www.docker.com/products/docker-desktop/"
            Write-Host "  Kurulumdan sonra Docker Desktop'i baslatin ve bu scripti tekrar calistirin."
            exit 1
        }

        Set-Location $AppDir
        Write-Host "[docker] docker compose baslatiliyor..." -ForegroundColor Yellow
        docker compose up -d --build

        $localIP2 = Get-LocalIP
        Write-Header "CipherNode Docker Basladi"
        Write-Host " Yerel : http://localhost:$Port"
        if ($localIP2) { Write-Host " LAN   : http://${localIP2}:$Port" }
        Write-Host ""
        Write-Host " Log takibi: docker compose logs -f"
        Write-Host " Durdurma : docker compose down"
        Write-Host ""
    }

    # ── SSL modu ──────────────────────────────────────────
    "ssl" {
        if (-not $SslDomain) {
            Write-Host "[Hata] -SslDomain parametresi gerekli!" -ForegroundColor Red
            Write-Host ""
            Write-Host "  Ornek:"
            Write-Host "    powershell -File scripts\windows-start.ps1 -Mode ssl -SslDomain relay.example.com"
            exit 1
        }

        # SSL kurulumunu calistir (yonetici yetkisi gerektirir)
        $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)

        if (-not $isAdmin) {
            Write-Host "[SSL] Yonetici yetkisi gerekiyor. Yukseltiliyor..." -ForegroundColor Yellow
            Start-Process powershell -ArgumentList `
                "-ExecutionPolicy Bypass -File `"$PSScriptRoot\setup-ssl-windows.ps1`" -Domain $SslDomain" `
                -Verb RunAs -Wait
        } else {
            & "$PSScriptRoot\setup-ssl-windows.ps1" -Domain $SslDomain -Port $Port
        }

        # Kurulumdan sonra SSL ile sunucuyu baslat
        Write-Header "CipherNode — SSL ile Baslatiliyor"
        $env:NODE_ENV  = "production"
        $env:PORT      = $Port
        $env:HOST      = "0.0.0.0"
        $env:SSL_DOMAIN = $SslDomain

        Set-Location $AppDir
        $serverFile = if (Test-Path "server_dist\index.mjs") { "server_dist\index.mjs" } else { "server_dist\index.js" }
        Write-Host ""
        Write-Host " HTTPS : https://$SslDomain" -ForegroundColor Green
        Write-Host " HTTP  : port 80 → HTTPS yonlendirme" -ForegroundColor Gray
        Write-Host " Durdurmak icin Ctrl+C"
        Write-Host ""
        node $serverFile
    }

    default {
        Write-Host "Bilinmeyen mod: $Mode" -ForegroundColor Red
        Write-Host "Gecerli modlar: server, ngrok, cloudflare, docker, ssl"
        exit 1
    }
}
