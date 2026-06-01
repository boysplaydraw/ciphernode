# ╔══════════════════════════════════════════════════════════════╗
# ║        CipherNode — Local Dev & Compile Helper Script        ║
# ║  Windows 11 ortamında Go Sidecar'ı derler ve dev modda açar.  ║
# ╚══════════════════════════════════════════════════════════════╝

$ErrorActionPreference = "Stop"

Write-Host "`n[1/3] Klasör yapılandırması kontrol ediliyor..." -ForegroundColor Cyan
$BinariesDir = Join-Path $PSScriptRoot "src-tauri\binaries"
if (!(Test-Path $BinariesDir)) {
    New-Item -ItemType Directory -Force -Path $BinariesDir | Out-Null
    Write-Host "✓ binaries klasörü oluşturuldu: $BinariesDir" -ForegroundColor Green
} else {
    Write-Host "✓ binaries klasörü mevcut." -ForegroundColor Green
}

Write-Host "`n[2/3] Go Backend Sidecar Windows için derleniyor..." -ForegroundColor Cyan
$BackendBinary = Join-Path $BinariesDir "ciphernode-backend-x86_64-pc-windows-msvc.exe"

# Go çevresel değişkenlerini ayarlayarak derle
$env:GOOS = "windows"
$env:GOARCH = "amd64"

try {
    # -s -w flagları binary boyutunu optimize eder
    go build -ldflags="-s -w" -o $BackendBinary ./server-go
    Write-Host "✓ Go backend başarıyla derlendi: $BackendBinary" -ForegroundColor Green
}
catch {
    Write-Host "`n❌ HATA: Go (Golang) backend derlenemedi!" -ForegroundColor Red
    Write-Host "Olası Nedenler:" -ForegroundColor Yellow
    Write-Host "  1) Sisteminizde Go (Golang) kurulu değil veya PATH çevre değişkenlerine eklenmemiş." -ForegroundColor Gray
    Write-Host "  2) 'go version' yazarak terminalde kurulu olduğunu kontrol edin." -ForegroundColor Gray
    Write-Host "Go indirme linki: https://go.dev/dl/" -ForegroundColor Cyan
    Write-Host "`nİşlem başarısız oldu." -ForegroundColor Red
    Read-Host "Kapatmak için Enter'a basın..."
    Exit 1
}

Write-Host "`n[3/3] Geliştirme ortamı başlatılmaya hazır!" -ForegroundColor Cyan
Write-Host "--------------------------------------------------------"
Write-Host "Şimdi yapabileceğiniz eylemler:" -ForegroundColor Yellow
Write-Host "  1) Standart Go Sunucusunu (Relay) Çalıştırmak için:" -ForegroundColor Gray
Write-Host "     cd server-go; go run ."
Write-Host "  2) Tauri Masaüstü Uygulamasını (Go Sidecar dahil) Çalıştırmak için:" -ForegroundColor Gray
Write-Host "     npm run tauri dev"
Write-Host "  3) React Native / Expo Web Sürümünü Çalıştırmak için:" -ForegroundColor Gray
Write-Host "     npx expo start --web"
Write-Host "--------------------------------------------------------`n"

# Tercihe bağlı: Kullanıcı doğrudan tauri'yi başlatmak isterse tetikle
$Choice = Read-Host "Tauri masaüstü uygulamasını şimdi başlatmak istiyor musunuz? (E/H veya Y/N)"
if ($Choice -eq "E" -or $Choice -eq "e" -or $Choice -eq "Y" -or $Choice -eq "y") {
    Write-Host "`nTauri dev paketi tetikleniyor..." -ForegroundColor Green
    try {
        # Bu satır npm yoksa exception fırlatır
        Start-Process cmd -ArgumentList "/c npm run tauri dev" -NoNewWindow -Wait
    }
    catch {
        Write-Host "`n❌ HATA: 'npm' komutu çalıştırılamadı!" -ForegroundColor Red
        Write-Host "Lütfen bilgisayarınızda Node.js ve npm'in yüklü olduğundan emin olun." -ForegroundColor Yellow
        Write-Host "Node.js indirme linki: https://nodejs.org/" -ForegroundColor Cyan
    }
}

Write-Host "`nİşlem tamamlandı." -ForegroundColor Green
Read-Host "Pencereyi kapatmak için Enter'a basın..."
