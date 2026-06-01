@echo off
title CipherNode Local Dev Helper
chcp 65001 > nul

echo ===================================================
echo [1/4] Checking Folder Structure and Dependencies...
echo ===================================================

:: Check if node_modules folder is missing and run npm install automatically
if not exist "%~dp0node_modules" (
    echo node_modules folder is missing. Running npm install to resolve dependencies...
    cd /d "%~dp0"
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] npm install failed. Please make sure Node.js/NPM is fully installed.
        echo.
        pause
        exit /b %errorlevel%
    )
    echo node_modules dependencies installed successfully.
) else (
    echo node_modules is already installed.
)

:: Create binaries directory if it does not exist
if not exist "%~dp0src-tauri\binaries" (
    mkdir "%~dp0src-tauri\binaries"
    echo binaries directory created successfully under src-tauri.
) else (
    echo binaries directory is present.
)

echo.
echo ===================================================
echo [2/4] Resolving Go Compiler and Compiling...
echo ===================================================

:: Smart Go Resolver
set GO_CMD=go
where go >nul 2>nul
if %errorlevel% neq 0 (
    if exist "C:\Program Files\Go\bin\go.exe" (
        set GO_CMD="C:\Program Files\Go\bin\go.exe"
        echo [INFO] Found Go compiler at standard path: C:\Program Files\Go\bin\go.exe
    ) else if exist "C:\Go\bin\go.exe" (
        set GO_CMD="C:\Go\bin\go.exe"
        echo [INFO] Found Go compiler at standard path: C:\Go\bin\go.exe
    ) else (
        echo [ERROR] Go compiler could not be found automatically!
        echo Please make sure Go is installed on your system.
        echo Download from: https://go.dev/dl/
        echo.
        pause
        exit /b 1
    )
) else (
    echo [INFO] Go compiler is active in system PATH.
)

set GOOS=windows
set GOARCH=amd64

:: Go modülü klasörüne mutlak geçiş (cd /d %~dp0server-go) yaparak derlemeyi oradan tetikleyelim
echo Entering server-go directory to resolve module root...
cd /d "%~dp0server-go"

echo Downloading and tidying Go dependencies (go mod tidy)...
%GO_CMD% mod tidy

echo Compiling Go binary...
%GO_CMD% build -ldflags="-s -w" -o "..\src-tauri\binaries\ciphernode-backend-x86_64-pc-windows-msvc.exe" .
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Go backend compilation failed!
    cd /d "%~dp0"
    pause
    exit /b %errorlevel%
)

:: Kök dizine kesin geri dön
cd /d "%~dp0"

echo ✓ Go backend sidecar compiled successfully: src-tauri\binaries\ciphernode-backend-x86_64-pc-windows-msvc.exe

echo.
echo ===================================================
echo [3/4] Ready to run local development environment!
echo ===================================================
echo Lütfen çalıştırmak istediğiniz eylemi seçin:
echo   [1] Tauri Masaüstü Uygulamasını Başlat (npm run tauri dev)
echo   [2] Expo Web Arayüzünü Başlat (npx expo start --web)
echo   [3] Sadece Go Güvenlik Sunucusunu Başlat (go run .)
echo   [4] Çıkış (Sadece pencereyi kapat)
echo ---------------------------------------------------
echo.

set /p CHOICE="Seçiminiz (1-4): "

if "%CHOICE%"=="1" (
    echo.
    echo Tauri Masaüstü uygulaması başlatılıyor...
    call npm run tauri dev
) else if "%CHOICE%"=="2" (
    echo.
    echo Expo Web Arayüzü başlatılıyor...
    call npx expo start --web
) else if "%CHOICE%"=="3" (
    echo.
    echo Standart Go Sunucusu başlatılıyor...
    cd /d "%~dp0server-go"
    go run .
) else if "%CHOICE%"=="4" (
    echo Çıkış yapılıyor...
    exit /b 0
) else (
    echo Geçersiz seçim yaptınız. Çıkış yapılıyor...
    pause
)
