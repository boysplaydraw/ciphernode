# CipherNode

**Uçtan uca şifreli, hesap gerektirmeyen, kendi relay sunucunuzla çalışabilen açık kaynak mesajlaşma uygulaması.**

[![Release](https://img.shields.io/github/v/release/boysplaydraw/ciphernode?color=cyan&label=son%20sürüm)](https://github.com/boysplaydraw/ciphernode/releases/latest)
[![License](https://img.shields.io/badge/lisans-GPLv3-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Android%20%7C%20Windows%20%7C%20Web-green)](https://github.com/boysplaydraw/ciphernode/releases)
[![Status](https://img.shields.io/badge/durum-aktif%20geliştirme-yellow)](https://github.com/boysplaydraw/ciphernode/commits/master)

---

## İndir

| Platform | Dosya | Açıklama |
|----------|-------|----------|
| **Windows** | [CipherNode Setup 1.0.0.exe](https://github.com/boysplaydraw/ciphernode/releases/latest/download/CipherNode.Setup.1.0.0.exe) | Kurulum paketi (önerilen) |
| **Windows** | [CipherNode 1.0.0.exe](https://github.com/boysplaydraw/ciphernode/releases/latest/download/CipherNode.1.0.0.exe) | Taşınabilir, kurulum gerektirmez |
| **Android** | EAS Build | `npm run build:apk:production` |

---

## Özellikler

- **Hesap gerektirmez** — Kimlik = yerel olarak üretilen kriptografik anahtar (XXXX-XXXX formatı)
- **Uçtan uca şifreleme** — OpenPGP (AES-256 + RSA) ile tam şifreleme
- **Tor/.onion desteği** — Varsayılan HTTPS relay; Tor Browser/Orbot veya harici hidden service ile opsiyonel ağ gizliliği
- **Grup sohbetleri** — Şifreli çok kullanıcılı grup mesajlaşması
- **Kaybolan mesajlar** — Seçilebilir süre sonunda otomatik silinen mesajlar
- **Büyük dosya transferi** — ≤100MB relay, >100MB P2P chunk aktarımı (5GB'a kadar)
- **Gizlilik modülleri** — Ekran koruması, biyometrik kilit, metadata temizleme, steganografi, hayalet mod
- **QR kod ile kişi ekleme** — Android'de kamera ile anlık kişi ekleme
- **Kendi sunucunu kur** — Docker, Termux veya herhangi bir Linux/Windows sunucusunda çalışır
- **HTTPS/SSL** — Docker Caddy profiliyle domain varsa otomatik HTTPS, domain yoksa HTTP/IP ile yerel veya LAN kullanım
- **Uygulamayı sıfırla** — Ayarlar'dan tek tuşla tüm veriyi sil ve başa dön

---

## Mimari

### Teknoloji Yığını

| Katman | Teknoloji |
|--------|-----------|
| Mobil / Masaüstü | React Native + Expo (Android, Windows/Electron, Web) |
| Backend | Express.js + Node.js + Socket.IO |
| Şifreleme | openpgp.js (OpenPGP uyumlu) |
| Gerçek zamanlı | WebSocket + Socket.IO relay |
| Depolama | AsyncStorage (mobil), localStorage (masaüstü) |

### Proje Yapısı

```
.
├── client/                 # React Native/Expo ön yüz
│   ├── screens/            # Uygulama ekranları
│   ├── components/         # Yeniden kullanılabilir bileşenler
│   ├── lib/                # Yardımcılar (crypto, storage, socket)
│   ├── hooks/              # Custom React hook'ları
│   ├── constants/          # Tema, dil, ayarlar
│   └── navigation/         # React Navigation yapısı
├── server/                 # Express arka uç
│   ├── index.ts            # SSL/HTTPS + sunucu başlatma
│   └── routes.ts           # API ve Socket.IO olayları
├── electron/               # Masaüstü (Electron) ana süreç
│   ├── main.ts             # IPC, Tor yönetimi, güncelleme
│   ├── preload.ts          # Güvenli köprü (contextBridge)
│   └── tor-manager.ts      # Yerleşik Tor süreci
├── scripts/                # Kurulum scriptleri
│   ├── setup-ssl.sh        # Linux Let's Encrypt kurulumu
│   └── setup-ssl-windows.ps1  # Windows win-acme SSL kurulumu
├── docker-entrypoint.sh    # Docker otomatik SSL üretimi
├── docker-compose.yml      # Docker yapılandırması
└── Dockerfile              # Çok aşamalı Alpine build
```

---

## Geliştirme

### Gereksinimler

- Node.js 20+
- npm
- Expo CLI (mobil geliştirme için)

### Kurulum

```bash
git clone https://github.com/boysplaydraw/ciphernode.git
cd ciphernode
npm install
```

### Geliştirme Sunucusu

```bash
# Terminal 1 — Express arka uç (port 5000)
npm run server:dev

# Terminal 2 — Expo geliştirme sunucusu
npx expo start
```

### Build

```bash
# Sunucu
npm run server:build

# Web (Expo export)
npm run electron:build:web

# Electron (Windows)
npm run electron:win

# Android APK (EAS)
npm run build:apk:production
```

---

## Sunucu Kurulumu

### Docker (Önerilen)

```bash
# Klon & başlat — web ve Go relay ayağa kalkar
git clone https://github.com/boysplaydraw/ciphernode.git
cd ciphernode
docker compose -f infra/docker/docker-compose.yml up -d
```

Web `http://sunucu-ip:8080`, API `http://sunucu-ip:5000` adresinde çalışır.

**Domain varsa Caddy ile otomatik HTTPS:**
```bash
set CADDY_SITE_ADDRESS=relay.example.com
set EXPO_PUBLIC_SERVER_URL=https://relay.example.com
docker compose -f infra/docker/docker-compose.yml --profile proxy up -d
```

### Linux (Manuel)

```bash
# Bağımlılıkları kur
npm install
npm run server:build

# HTTP olarak başlat
NODE_ENV=production node server_dist/index.mjs

# HTTPS + Let's Encrypt
sudo bash scripts/setup-ssl.sh relay.example.com admin@example.com
SSL_DOMAIN=relay.example.com node server_dist/index.mjs
```

### Windows

```powershell
# Geliştirme — HTTP
powershell -File scripts\windows-start.ps1

# Üretim — SSL (win-acme ile Let's Encrypt)
powershell -File scripts\windows-start.ps1 -Mode ssl -SslDomain relay.example.com

# Tünel ile (domain olmadan, otomatik HTTPS)
powershell -File scripts\windows-start.ps1 -Mode cloudflare
powershell -File scripts\windows-start.ps1 -Mode ngrok
```

### Termux (Android)

```bash
bash termux-start.sh
```

---

## Tor Kurulumu

### Android (Orbot)
1. [Orbot](https://play.google.com/store/apps/details?id=org.torproject.android)'u Play Store'dan yükleyin
2. "Tüm Uygulamalar için VPN" modunu etkinleştirin
3. CipherNode'u açın → Ayarlar → Tor → etkinleştirin

### Web / Desktop
Web uygulamasında Tor için Tor Browser kullanın. Desktop paketinde Tor desteği varsa Ayarlar → Tor Bağlantısı üzerinden yönetilir; paketlenmemiş geliştirme build'lerinde harici Tor proxy gerekir.

### Sunucu .onion adresi
Docker image Tor daemon çalıştırmaz. Host üzerinde Tor hidden service kurup web/API portlarını relay'e yönlendirin, sonra `.env` veya compose ortamında `ONION_ADDRESS=abc123...xyz.onion` ayarlayın. Backend bu adresi `GET /api/onion-address` ile döner ve uygulama Ağ Ayarları ekranında gösterir.

---

## Gizlilik ve Güvenlik

### Kimlik Sistemi

Kullanıcılar PGP açık anahtarının SHA-256 karması ile tanımlanır (`XXXX-XXXX` formatı):
- Kişisel bilgi toplanmaz
- Kayıt, e-posta, telefon numarası gerekmez
- Kimlik tamamen kriptografik

### Mesaj Şifreleme

1. Mesajlar gönderilmeden önce **alıcının açık anahtarıyla** şifrelenir (RSA)
2. Şifreli yük **AES-256** ile ek katman şifreleme alır
3. Sunucu yalnızca şifreli veriyi görür, içeriği okuyamaz
4. Şifre çözme yalnızca alıcı cihazında gerçekleşir

### Gizlilik Modülleri

| Modül | Açıklama |
|-------|----------|
| Ekran Koruması | Ekran görüntüsü ve kaydı engeller |
| Biyometrik Kilit | Parmak izi / yüz ile kilit |
| Metadata Temizleme | Görsel paylaşımında EXIF verilerini siler |
| Steganografi Modu | Mesajları görünmez Unicode karakterlere gömer |
| Hayalet Mod | Yazıyor göstergesi ve okundu bilgisini gizler |
| Sadece P2P | Mesajları yalnızca alıcı çevrimiçiyken iletir |

---

## Ortam Değişkenleri

```env
# Temel sunucu ayarları
NODE_ENV=production
PORT=5000
HOST=0.0.0.0

# SSL (isteğe bağlı)
SSL_DOMAIN=relay.example.com   # Let's Encrypt için domain
SSL_EMAIL=admin@example.com    # Let's Encrypt bildirimleri
SSL_CERT=/yol/cert.pem         # Manuel sertifika yolu
SSL_KEY=/yol/key.pem           # Manuel anahtar yolu
HTTPS=false                    # SSL'i tamamen kapat

# Mesaj & dosya ayarları
MESSAGE_TTL_MS=86400000        # Mesaj yaşam süresi (ms)
FILE_TTL_MS=86400000           # Dosya yaşam süresi (ms)
MAX_FILE_SIZE_MB=100           # Maksimum dosya boyutu

# Uygulama
EXPO_PUBLIC_SERVER_URL=https://relay.example.com
ONION_ADDRESS=abc123...xyz.onion # isteğe bağlı; harici Tor hidden service adresi
```

---

## API

### HTTP Endpoint'leri

| Endpoint | Açıklama |
|----------|----------|
| `GET /api/health` | Sunucu sağlık kontrolü |
| `GET /api/users/:id/publickey` | Açık anahtar sorgula |
| `GET /api/contacts/:userId` | Kişi listesini çek |
| `POST /api/contacts/:userId` | Kişi listesini güncelle |
| `GET /api/onion-address` | .onion adresi sorgula |

### Socket.IO Olayları

| Olay | Açıklama |
|------|----------|
| `register` | Kullanıcı kimliği kaydet |
| `message` | Şifreli mesaj gönder |
| `typing` | Yazıyor göstergesi |
| `read` | Okundu bildirimi |
| `group:message` | Grup mesajı |

---

## Katkıda Bulunma

1. Fork'layın
2. Feature branch oluşturun (`git checkout -b feature/ozellik`)
3. Değişikliklerinizi commit'leyin
4. Push'layın ve Pull Request açın

```bash
npm run lint        # Kod kalitesi kontrolü
npm run format      # Prettier ile biçimlendirme
npm run check:types # TypeScript tip kontrolü
```

---

## Güvenlik Bildirimi

Güvenlik açıkları için GitHub Issues **kullanmayın**. Lütfen doğrudan iletişime geçin.

---

## Lisans

**GNU General Public License v3.0** — Ayrıntılar için [LICENSE](LICENSE) dosyasına bakın.

Tüm türev çalışmalar aynı GPLv3 lisansı altında açık kaynak olarak dağıtılmalıdır.

---

## Yasal Uyarı

CipherNode aktif geliştirme aşamasındadır. Güvenlik öncelikli olarak tasarlanmış olsa da hiçbir yazılım %100 güvenli değildir. Üretim ortamında kullanmadan önce kendi güvenlik denetiminizi yapın.

---

*Son güncelleme: Nisan 2026*
## Go/Tauri Migration Status

This repository now contains a migration scaffold from the Node.js Socket.IO backend and Electron desktop shell toward:

```text
apps/
  mobile/
  web/
  desktop/
server/
  go/
packages/
  crypto/
  shared/
infra/
  docker/
```

The existing mobile/web client remains compatible with the Node.js Socket.IO server by default. The new Go relay uses raw WebSocket at `/ws`; select it from clients with `EXPO_PUBLIC_RELAY_TRANSPORT=websocket`.

### Go Backend

```bash
cd server/go
go test ./...
go run ./cmd/ciphernode-server
```

Endpoints:

- `GET /health`
- `GET /api/health`
- `GET /api/stats`
- `GET /api/users/:userId/publickey`
- `POST /api/files/upload`
- `GET /api/files/:fileId`
- `GET /api/files/:fileId/info`
- `GET /ws`

Environment examples:

```bash
PORT=5000
HOST=0.0.0.0
MESSAGE_TTL=24h
FILE_TTL=24h
RATE_LIMIT_PER_MINUTE=120
MAX_FILE_SIZE_MB=100
```

### Tauri Desktop

```bash
cd apps/desktop
npm install
npm run dev
```

The Tauri shell loads the existing Expo Web frontend and exposes native command placeholders for `start_tor`, `stop_tor`, `get_tor_status` and `configure_proxy`. Electron remains in the repo until the Tauri command bridge reaches feature parity.

### Docker Self-Host

```bash
docker compose -f infra/docker/docker-compose.yml up --build
```

Services include `go-server`, `web`, optional `redis` profile and optional `reverse-proxy` profile.

### Security Model

The server is relay-only. E2EE stays on the client; the Go backend stores or forwards encrypted payloads and metadata only. No external audit has been completed. See `THREAT_MODEL.md`, `SECURITY.md` and `docs/e2ee-flow.md`.

### Migration Roadmap

- Complete Socket.IO feature parity in the Go WebSocket protocol, including full matching-session behavior.
- Replace direct `socket.io-client` usage with `packages/shared` transport adapters.
- Move client crypto helpers into `packages/crypto`.
- Replace Electron IPC calls with a desktop bridge that supports Tauri `invoke`.
- Add Redis-backed storage implementation and integration tests.
