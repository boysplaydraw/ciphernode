# Tor Binary Kurulumu

Tor Expert Bundle'ı https://www.torproject.org/download/tor/ adresinden indirin.

## Klasör Yapısı

```
tor-bin/
  windows/
    tor.exe          ← Windows x64 Tor binary
    *.dll            ← Gerekli DLL dosyaları

  macos-x64/
    tor              ← macOS Intel (x64) Tor binary
    libevent-*.dylib ← Gerekli dylib dosyaları

  macos-arm64/
    tor              ← macOS Apple Silicon (ARM64) Tor binary
    libevent-*.dylib ← Gerekli dylib dosyaları

  linux/
    tor              ← Linux x64 Tor binary
    *.so.*           ← Gerekli shared library dosyaları
```

## İndirme ve Kurulum

### Windows
```
tor-expert-bundle-windows-x86_64-*.tar.gz → içinden tor/ klasörünü windows/ içine çıkar
```

### macOS Intel
```
tor-expert-bundle-macos-x86_64-*.tar.gz → içinden tor/ klasörünü macos-x64/ içine çıkar
chmod +x macos-x64/tor
```

### macOS Apple Silicon (ARM64)
```
tor-expert-bundle-macos-aarch64-*.tar.gz → içinden tor/ klasörünü macos-arm64/ içine çıkar
chmod +x macos-arm64/tor
```

### Linux
```
tor-expert-bundle-linux-x86_64-*.tar.gz → içinden tor/ klasörünü linux/ içine çıkar
chmod +x linux/tor
```

> **Not:** Tor binary'leri git'e eklenmez (.gitignore). Her geliştirici kendi binary'sini indirmelidir.
