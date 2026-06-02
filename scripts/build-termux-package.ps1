param(
  [string]$OutputDir = "termux-package"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
Set-Location $root

function Reset-Directory([string]$Path) {
  if (Test-Path -LiteralPath $Path) {
    Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
      try { $_.Attributes = "Normal" } catch {}
    }
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Copy-Directory([string]$Source, [string]$Destination) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  robocopy $Source $Destination /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed for $Source -> $Destination with code $LASTEXITCODE"
  }
}

npm.cmd run electron:build:web
npm.cmd run server:build

$packageRoot = Join-Path $root $OutputDir

try {
  Reset-Directory $packageRoot
} catch {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $packageRoot = Join-Path $root "$OutputDir-$stamp"
  Reset-Directory $packageRoot
}

$appRoot = Join-Path $packageRoot "ciphernode-termux"
New-Item -ItemType Directory -Force -Path (Join-Path $appRoot "server_dist") | Out-Null

Copy-Item -LiteralPath "server_dist/index.mjs" -Destination (Join-Path $appRoot "server_dist/index.mjs")
Copy-Directory "dist" (Join-Path $appRoot "dist")
Copy-Directory "assets" (Join-Path $appRoot "assets")
Copy-Directory "website" (Join-Path $appRoot "website")
Copy-Item -LiteralPath "app.json" -Destination $appRoot
Copy-Item -LiteralPath "package.runtime.json" -Destination (Join-Path $appRoot "package.json")
Copy-Item -LiteralPath "package.runtime.json" -Destination $appRoot
Copy-Item -LiteralPath "termux-start.sh" -Destination $appRoot

$readme = @'
# CipherNode Termux Rootless Package

Bu paket Android Termux uzerinde root olmadan calisir.

Kurulum:

```sh
pkg update
pkg install -y nodejs tar
tar -xzf ciphernode-termux.tar.gz
cd ciphernode-termux
bash termux-start.sh
```

LAN adresi:

```text
http://TELEFON_IP:5000/app
```

HTTPS tunnel (onerilen):

```sh
bash termux-start.sh cloudflare
```

Alternatif HTTPS tunnel:

```sh
bash termux-start.sh localtunnel
```

Tor hidden service:

```sh
bash termux-start.sh tor
```

Notlar:
- Root gerekmez.
- Android/Termux rootless ortamda 80 ve 443 gibi dusuk portlar kullanilmaz.
- Varsayilan port 5000'dir. Degistirmek icin: `PORT=7000 bash termux-start.sh`
- Normal tarayici veya mobil uygulama HTTPS istiyorsa `cloudflare` ya da `localtunnel` modunu kullanin.
'@

Set-Content -LiteralPath (Join-Path $appRoot "README.md") -Value $readme -Encoding UTF8

$archive = Join-Path $packageRoot "ciphernode-termux.tar.gz"
tar -czf $archive -C $packageRoot "ciphernode-termux"

Write-Host "Termux package created: $archive"
