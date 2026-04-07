# CipherNode

**Tor tabanlı, uçtan uca şifreli, hesap gerektirmeyen açık kaynak mesajlaşma uygulaması.**

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
- **Tor desteği** — Android'de Orbot, masaüstünde yerleşik Tor; IP adresinizi gizleyin
- **Grup sohbetleri** — Şifreli çok kullanıcılı grup mesajlaşması
- **Kaybolan mesajlar** — Seçilebilir süre sonunda otomatik silinen mesajlar
- **Büyük dosya transferi** — ≤100MB relay, >100MB P2P chunk aktarımı (5GB'a kadar)
- **Gizlilik modülleri** — Ekran koruması, biyometrik kilit, metadata temizleme, steganografi, hayalet mod
- **QR kod ile kişi ekleme** — Android'de kamera ile anlık kişi ekleme
- **Kendi sunucunu kur** — Docker, Termux veya herhangi bir Linux/Windows sunucusunda çalışır
- **HTTPS/SSL** — Let's Encrypt veya self-signed sertifika ile otomatik HTTPS
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

### Docker (Önerilen) — Otomatik HTTPS

```bash
# Klon & başlat — ilk çalıştırmada self-signed SSL otomatik üretilir
git clone https://github.com/boysplaydraw/ciphernode.git
cd ciphernode
docker compose up -d
```

Sunucu `https://sunucu-ip` adresinde çalışır. İlk bağlantıda tarayıcı uyarısı çıkar; "Gelişmiş → Yine de devam et" seçeneğiyle bir kez kabul edin.

**Domain varsa Let's Encrypt otomatik:**
```bash
# .env dosyası oluştur
echo "SSL_DOMAIN=relay.example.com" > .env
echo "SSL_EMAIL=admin@example.com" >> .env
docker compose up -d
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

### Windows / macOS / Linux (Electron)
Yerleşik Tor yönetimi — harici araç gerekmez. Ayarlar → Tor Bağlantısı → açın.

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
