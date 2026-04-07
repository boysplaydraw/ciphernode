# ============================================================
# CipherNode — Windows SSL Kurulumu (Let's Encrypt + win-acme)
# Kullanim: powershell -ExecutionPolicy Bypass -File scripts\setup-ssl-windows.ps1 -Domain relay.example.com
# Ornek:    powershell -ExecutionPolicy Bypass -File scripts\setup-ssl-windows.ps1 -Domain relay.example.com -Email admin@example.com
# ============================================================
# Gereksinimler:
#   - Windows 10/11 veya Windows Server 2016+
#   - PowerShell 5.1+
#   - Yonetici (Administrator) yetkisi
#   - Domain adi (A kaydi bu sunucuya yonlendirilmis olmali)
#   - Port 80 ve 443 acik olmali (Windows Firewall)
# ============================================================

param(
    [Parameter(Mandatory = $true)]
    [string]$Domain,

    [string]$Email = "admin@$Domain",

    [int]$Port = 5000,

    # NSSM ile Windows servisi olarak kur
    [switch]$InstallService,

    # Sadece sertifika al, servis kurma
    [switch]$CertOnly
)

$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $PSScriptRoot

# Renk yardimcilari
function Write-Ok($msg)   { Write-Host "[OK]  $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "[..] $msg"  -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "[!!] $msg"  -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[XX] $msg"  -ForegroundColor Red }

function Write-Header($text) {
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
}

# ── Yonetici yetkisi kontrolu ───────────────────────────────
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Err "Bu script Yonetici (Administrator) olarak calistirilmalidir."
    Write-Host "  Cozum: PowerShell'i sag tikla → 'Yonetici olarak calistir'"
    exit 1
}

Write-Header "CipherNode SSL Kurulumu — Windows"
Write-Host " Domain : $Domain"
Write-Host " Email  : $Email"
Write-Host " Port   : $Port"
Write-Host ""

# ── Dizinler ────────────────────────────────────────────────
$DataDir  = "$env:ProgramData\CipherNode"
$SslDir   = "$DataDir\ssl"
$WacsDir  = "$DataDir\win-acme"
$WacsExe  = "$WacsDir\wacs.exe"

New-Item -ItemType Directory -Force $DataDir  | Out-Null
New-Item -ItemType Directory -Force $SslDir   | Out-Null
New-Item -ItemType Directory -Force $WacsDir  | Out-Null

# ── 1. win-acme indir (Let's Encrypt istemcisi) ─────────────
Write-Info "win-acme kontrol ediliyor..."

if (-not (Test-Path $WacsExe)) {
    Write-Info "win-acme indiriliyor..."

    # GitHub API'den en son surumu bul
    try {
        $release = Invoke-RestMethod "https://api.github.com/repos/win-acme/win-acme/releases/latest"
        $asset   = $release.assets | Where-Object { $_.name -like "win-acme.v*.x64.trimmed.zip" } | Select-Object -First 1
        if (-not $asset) {
            $asset = $release.assets | Where-Object { $_.name -like "*x64*.zip" -and $_.name -notlike "*pluggable*" } | Select-Object -First 1
        }
        $wacsUrl = $asset.browser_download_url
        $wacsVer = $release.tag_name
    } catch {
        # Fallback: sabit URL
        $wacsVer = "v2.2.9.1701"
        $wacsUrl = "https://github.com/win-acme/win-acme/releases/download/$wacsVer/win-acme.$wacsVer.x64.trimmed.zip"
    }

    Write-Info "win-acme $wacsVer indiriliyor: $wacsUrl"
    $zipPath = "$env:TEMP\wacs.zip"
    Invoke-WebRequest $wacsUrl -OutFile $zipPath -UseBasicParsing
    Expand-Archive $zipPath -DestinationPath $WacsDir -Force
    Remove-Item $zipPath

    if (-not (Test-Path $WacsExe)) {
        # Bazi surumlerde iceride klasor olabilir
        $inner = Get-ChildItem $WacsDir -Filter "wacs.exe" -Recurse | Select-Object -First 1
        if ($inner) {
            Copy-Item $inner.FullName $WacsExe
        } else {
            Write-Err "wacs.exe bulunamadi. Manuel indirin: https://www.win-acme.com"
            exit 1
        }
    }
}

Write-Ok "win-acme hazir: $WacsExe"

# ── 2. Port 80 kontrolu (ACME HTTP challenge icin) ──────────
Write-Info "Port 80 uygunlugu kontrol ediliyor..."

$port80 = netstat -an 2>$null | Select-String ":80 " | Select-String "LISTENING"
if ($port80) {
    Write-Warn "Port 80 baska bir uygulama tarafindan kullaniliyor."
    Write-Warn "IIS, Apache veya baska bir sunucu varsa Let's Encrypt dogrulamasi basarisiz olabilir."
    Write-Warn "Devam etmek istiyor musunuz? (E/H)"
    $ans = Read-Host
    if ($ans -notmatch "^[Ee]$") {
        Write-Err "Iptal edildi. Port 80'i serbest birakip tekrar deneyin."
        exit 1
    }
}

# ── 3. Windows Firewall — port 80 ve 443 ac ─────────────────
Write-Info "Windows Firewall portlari aciliyor (80, 443)..."
netsh advfirewall firewall delete rule name="CipherNode HTTP"  2>$null | Out-Null
netsh advfirewall firewall delete rule name="CipherNode HTTPS" 2>$null | Out-Null
netsh advfirewall firewall add rule name="CipherNode HTTP"  dir=in action=allow protocol=TCP localport=80  | Out-Null
netsh advfirewall firewall add rule name="CipherNode HTTPS" dir=in action=allow protocol=TCP localport=443 | Out-Null
Write-Ok "Firewall kurallari eklendi."

# ── 4. Let's Encrypt sertifikasi al ─────────────────────────
Write-Info "Let's Encrypt sertifikasi aliniyor..."
Write-Info "Domain: $Domain — Lutfen DNS'in dogru yapilandirildiginden emin olun."
Write-Host ""

$certPem  = "$SslDir\$Domain-chain.pem"
$keyPem   = "$SslDir\$Domain-key.pem"
$wacsArgs = @(
    "--target", "manual",
    "--host", $Domain,
    "--emailaddress", $Email,
    "--accepttos",
    "--store", "pemfiles",
    "--pemfilespath", $SslDir,
    "--installation", "none",
    "--nocache"
)

Write-Info "win-acme calistiriliyor..."
Write-Host "   $WacsExe $($wacsArgs -join ' ')" -ForegroundColor DarkGray
Write-Host ""

& $WacsExe @wacsArgs

if ($LASTEXITCODE -ne 0) {
    Write-Err "win-acme basarisiz oldu (exit code: $LASTEXITCODE)"
    Write-Host ""
    Write-Host "  Olasi nedenler:"
    Write-Host "    - Domain A kaydi bu sunucuyu gostermiyordur"
    Write-Host "    - Port 80 erisilebilir degil (NAT/router port yonlendirmesi gerekebilir)"
    Write-Host "    - Let's Encrypt rate limit (ayda 5 istek limiti)"
    Write-Host ""
    Write-Host "  Alternatif — Manuel sertifika:"
    Write-Host "    SSL_CERT=C:\yol\cert.pem SSL_KEY=C:\yol\key.pem node server_dist\index.js"
    exit 1
}

# win-acme PEM dosyalarini farkli isimle kaydedebilir, bul
$certFile = Get-ChildItem $SslDir -Filter "*$Domain*chain*" | Select-Object -First 1
if (-not $certFile) {
    $certFile = Get-ChildItem $SslDir -Filter "*.pem" | Where-Object { $_.Name -notlike "*key*" } | Select-Object -First 1
}
$keyFile = Get-ChildItem $SslDir -Filter "*$Domain*key*" | Select-Object -First 1
if (-not $keyFile) {
    $keyFile = Get-ChildItem $SslDir -Filter "*key*.pem" | Select-Object -First 1
}

if (-not $certFile -or -not $keyFile) {
    Write-Err "PEM dosyalari $SslDir klasorunde bulunamadi."
    Write-Host "  win-acme ciktisini kontrol edin ve SSL_CERT / SSL_KEY env varlarini manuel ayarlayin."
    exit 1
}

$certPem = $certFile.FullName
$keyPem  = $keyFile.FullName

Write-Ok "Sertifika: $certPem"
Write-Ok "Anahtar  : $keyPem"

# ── 5. .env dosyasini guncelle ───────────────────────────────
$envFile = "$AppDir\.env"
Write-Info ".env dosyasi guncelleniyor..."

$envLines = @()
if (Test-Path $envFile) {
    $envLines = Get-Content $envFile | Where-Object {
        $_ -notmatch "^SSL_CERT=" -and
        $_ -notmatch "^SSL_KEY="  -and
        $_ -notmatch "^SSL_DOMAIN="
    }
}
$envLines += "SSL_DOMAIN=$Domain"
$envLines += "SSL_CERT=$certPem"
$envLines += "SSL_KEY=$keyPem"
$envLines | Set-Content $envFile -Encoding UTF8
Write-Ok ".env guncellendi: $envFile"

# ── 6. Otomatik yenileme — Windows Gorev Zamanlayici ────────
Write-Info "Otomatik yenileme zamanlayicisi kuruluyor..."

$taskName   = "CipherNode SSL Yenileme"
$taskAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -Command `"& '$WacsExe' --renew --force`""

$taskTrigger = New-ScheduledTaskTrigger -Daily -At "03:00"

$taskSettings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 10)

$taskPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask `
    -TaskName $taskName `
    -Action $taskAction `
    -Trigger $taskTrigger `
    -Settings $taskSettings `
    -Principal $taskPrincipal `
    -Force | Out-Null

Write-Ok "Zamanlayici kuruldu: Her gece 03:00'de yenileme denenecek."

# ── 7. Windows Servisi kur (NSSM ile) ───────────────────────
if ($InstallService -and -not $CertOnly) {
    Write-Info "Windows servisi kuruluyor (NSSM)..."

    $nssmExe = "$DataDir\nssm\nssm.exe"
    if (-not (Test-Path $nssmExe)) {
        Write-Info "NSSM indiriliyor..."
        $nssmUrl  = "https://nssm.cc/release/nssm-2.24.zip"
        $nssmZip  = "$env:TEMP\nssm.zip"
        $nssmDir  = "$DataDir\nssm"
        Invoke-WebRequest $nssmUrl -OutFile $nssmZip -UseBasicParsing
        Expand-Archive $nssmZip -DestinationPath $nssmDir -Force
        # 64-bit binary bul
        $nssmBin = Get-ChildItem $nssmDir -Filter "nssm.exe" -Recurse |
                   Where-Object { $_.DirectoryName -match "win64" } |
                   Select-Object -First 1
        if (-not $nssmBin) {
            $nssmBin = Get-ChildItem $nssmDir -Filter "nssm.exe" -Recurse | Select-Object -First 1
        }
        Copy-Item $nssmBin.FullName $nssmExe -Force
        Remove-Item $nssmZip
    }

    $nodePath  = (Get-Command node).Source
    $serverJs  = "$AppDir\server_dist\index.js"
    $svcName   = "CipherNode"

    # Eski servisi durdur ve sil
    & $nssmExe stop   $svcName 2>$null
    & $nssmExe remove $svcName confirm 2>$null

    # Servisi kur
    & $nssmExe install $svcName $nodePath $serverJs
    & $nssmExe set     $svcName AppDirectory $AppDir
    & $nssmExe set     $svcName AppEnvironmentExtra `
        "NODE_ENV=production" `
        "PORT=$Port" `
        "HOST=0.0.0.0" `
        "SSL_DOMAIN=$Domain" `
        "SSL_CERT=$certPem" `
        "SSL_KEY=$keyPem"
    & $nssmExe set $svcName Start SERVICE_AUTO_START
    & $nssmExe set $svcName AppStdout "$DataDir\logs\stdout.log"
    & $nssmExe set $svcName AppStderr "$DataDir\logs\stderr.log"

    New-Item -ItemType Directory -Force "$DataDir\logs" | Out-Null

    & $nssmExe start $svcName
    Write-Ok "Windows servisi baslatildi: $svcName"
    Write-Ok "Servis durumu: Get-Service $svcName"
}

# ── Sonuc ────────────────────────────────────────────────────
Write-Header "SSL Kurulumu Tamamlandi!"
Write-Host ""
Write-Host "  Sertifika : $certPem"
Write-Host "  Anahtar   : $keyPem"
Write-Host "  Yenileme  : Her gece 03:00 (Windows Gorev Zamanlayici)"
Write-Host ""
Write-Host "  Sunucuyu SSL ile baslatmak icin:" -ForegroundColor Cyan
Write-Host ""
Write-Host "    cd $AppDir"
Write-Host "    `$env:SSL_DOMAIN='$Domain'"
Write-Host "    `$env:SSL_CERT='$certPem'"
Write-Host "    `$env:SSL_KEY='$keyPem'"
Write-Host "    node server_dist\index.js"
Write-Host ""
Write-Host "  Veya .env dosyasindan otomatik yukler:" -ForegroundColor Cyan
Write-Host "    node server_dist\index.js   (`.env` okunur)"
Write-Host ""
Write-Host "  HTTPS URL : https://$Domain"
Write-Host ""
Write-Host "  Yenilemeyi test etmek icin:"
Write-Host "    & '$WacsExe' --renew --force"
Write-Host ""

if ($InstallService) {
    Write-Host "  Servis yonetimi:" -ForegroundColor Cyan
    Write-Host "    Durdur  : Stop-Service CipherNode"
    Write-Host "    Baslat  : Start-Service CipherNode"
    Write-Host "    Durum   : Get-Service CipherNode"
    Write-Host "    Log     : $DataDir\logs\"
    Write-Host ""
}

Write-Host "==========================================" -ForegroundColor Green
