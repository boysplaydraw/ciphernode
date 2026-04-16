# CipherNode — CasaOS Kurulum Rehberi

CipherNode'u CasaOS'a kurmanın **2 yolu** var:

| Yol | Açıklama |
|-----|----------|
| [Yol 1 — Dosyayla Kur](#yol-1--dosyayla-kur-önerilen) | casaos-app.yaml dosyasını yapıştır (PostgreSQL dahil) |
| [Yol 2 — Terminal ile Kur](#yol-2--terminal-ile-kur) | SSH üzerinden komutla kur |

---

## Gereksinimler

- CasaOS kurulu bir cihaz (Raspberry Pi, x86 mini PC, NAS vb.)
- CasaOS sürüm 0.4.4 veya üstü
- İnternet bağlantısı (Docker image indirmek için)

---

## Yol 1 — Dosyayla Kur (Önerilen)

### Adım 1: App Store'u Aç

CasaOS panelinde sağ üstteki **App Store** simgesine tıklayın.

```
CasaOS Ana Sayfa → Sağ Üst Köşe → App Store simgesi
```

### Adım 2: Custom Install

App Store'da sağ üstteki **Custom Install** (veya `+` / `Import`) butonuna tıklayın.

### Adım 3: YAML Dosyasını Yapıştır

Aşağıdaki URL'den dosyayı import edin:

```
https://raw.githubusercontent.com/boysplaydraw/ciphernode/master/casaos/casaos-app.yaml
```

**Veya** dosyanın içeriğini kopyalayıp metin kutusuna yapıştırın.

### Adım 4: Şifreyi Belirle (Opsiyonel)

CasaOS kurulum ekranında çevre değişkenlerini göreceksiniz.  
`DB_PASSWORD` değerini güçlü bir şifreyle değiştirmenizi öneririz:

```
DB_PASSWORD  →  guclu_bir_sifre_girin
```

> Boş bırakırsanız varsayılan `ciphernode_secret` kullanılır (güvensiz, sadece test için).

### Adım 5: Kur

**Install** butonuna tıklayın. Docker Hub'dan image'lar indirilir (~1-2 dakika).

### Adım 6: Aç

Kurulum tamamlandığında CasaOS ana sayfasında **CipherNode** simgesi görünür.  
Simgeye tıklayarak web arayüzüne ulaşın.

---

## Yol 2 — Terminal ile Kur

CasaOS cihazına SSH ile bağlanın, ardından:

```bash
# Dosyaları indir
mkdir -p /DATA/AppData/ciphernode
cd /DATA/AppData/ciphernode

curl -O https://raw.githubusercontent.com/boysplaydraw/ciphernode/master/casaos/casaos-app.yaml
curl -O https://raw.githubusercontent.com/boysplaydraw/ciphernode/master/.env.example
cp .env.example .env

# Şifreyi ayarla
nano .env
# DB_PASSWORD=guclu_bir_sifre_girin satırını düzenle

# Başlat
docker compose -f casaos-app.yaml up -d
```

---

## Nasıl Çalışır?

### Servis Mimarisi

```
Tarayıcı → http://[CasaOS-IP]:8080
                    │
             [ciphernode-web]
              nginx gateway
             /              \
  Expo SPA              /api/* + /socket.io/*
  (static)                     │ proxy
                        [ciphernode-relay]
                         port 5000 (iç)
                                │
                        [ciphernode-db]
                         PostgreSQL 16
```

### Web Uygulaması (Port 8080)

CasaOS panelinde **CipherNode** simgesine tıklayınca açılan sayfa:

```
http://[CasaOS-IP]:8080
```

Bu, tam işlevsel **mesajlaşma web uygulamasıdır**. Telefona uygulama indirmeden tarayıcıdan kullanabilirsiniz.

- Aynı ağdaki herhangi bir cihazdan erişilebilir (PC, tablet, telefon)
- `/api/*` ve `/socket.io/*` istekleri otomatik olarak relay'e yönlendirilir
- Ekstra yapılandırma gerekmez — sunucu URL'i otomatik tespit edilir

### Relay API (Port 5000)

Mobil uygulamanın bağlandığı backend:

```
http://[CasaOS-IP]:5000
```

### Mobil Uygulama Bağlantısı

1. Telefonunuza **CipherNode** uygulamasını indirin (Android APK veya iOS)
2. Uygulamayı açın → Ayarlar → Sunucu URL
3. CasaOS cihazınızın IP adresini girin:
   ```
   http://192.168.1.100:5000
   ```
4. Kaydet — uygulama relay sunucusuna bağlanır

> **Yerel ağda:** `192.168.x.x:5000` kullanın  
> **İnternetten:** Router'da port yönlendirme gerekir (`5000` → CasaOS IP)

---

## SSL / HTTPS Ayarı (Opsiyonel)

### Self-Signed (Hızlı)

CasaOS App Store'daki çevre değişkenlerinden:
```
HTTPS  →  true
```
Sunucu başlangıçta otomatik sertifika üretir. Tarayıcı uyarısı verebilir.

### Let's Encrypt (Gerçek Domain)

Bir domain adınız varsa (örn. `relay.example.com`):

```bash
# CasaOS SSH terminalinde:

# 1. Relay'i geçici durdur
docker stop ciphernode-relay

# 2. Certbot ile sertifika al
docker run --rm \
  -p 80:80 \
  -v /DATA/AppData/ciphernode/letsencrypt:/etc/letsencrypt \
  certbot/certbot certonly \
    --standalone \
    --non-interactive \
    --agree-tos \
    --email admin@relay.example.com \
    --domain relay.example.com

# 3. Sertifika konumunu ayarla
# casaos-app.yaml'daki environment bölümüne ekle:
#   SSL_CERT: /app/ssl/letsencrypt/live/relay.example.com/fullchain.pem
#   SSL_KEY:  /app/ssl/letsencrypt/live/relay.example.com/privkey.pem
#   HTTPS: "true"

# 4. Relay'i yeniden başlat
docker start ciphernode-relay
```

---

## Sorun Giderme

### Simge Yüklenmiyor / Uygulama Açılmıyor

```bash
# Container durumunu kontrol et
docker ps | grep ciphernode

# Logları gör
docker logs ciphernode-relay
docker logs ciphernode-db
```

### Veritabanı Bağlantı Hatası

```bash
# db container'ının çalışıp çalışmadığını kontrol et
docker ps | grep ciphernode-db

# db sağlık durumu
docker inspect ciphernode-db | grep -A5 '"Health"'
```

### Port Çakışması (5000 kullanımda)

CasaOS App Store'da **Port** ayarını değiştirin:
```
5000  →  5100  (veya başka boş bir port)
```

### Uygulama Güncellemesi

```bash
# En son image'ı çek ve yeniden başlat
docker pull mero003/ciphernode:latest
docker compose -f /DATA/AppData/ciphernode/casaos-app.yaml up -d
```

---

## Veri ve Yedekleme

CasaOS kurulumunda tüm veriler şu dizinde saklanır:

```
/DATA/AppData/ciphernode/
├── db/          ← PostgreSQL veritabanı dosyaları
└── ssl/         ← SSL sertifikaları
```

**Yedekleme:**
```bash
# Veritabanı yedeği
docker exec ciphernode-db \
  pg_dump -U ciphernode ciphernode > /DATA/AppData/ciphernode/backup.sql

# Geri yükleme
docker exec -i ciphernode-db \
  psql -U ciphernode ciphernode < /DATA/AppData/ciphernode/backup.sql
```

---

## Kaldırma

CasaOS panelinden: CipherNode → Sağ Tık → **Uninstall**

Tüm verileri de silmek için:
```bash
docker compose -f /DATA/AppData/ciphernode/casaos-app.yaml down -v
rm -rf /DATA/AppData/ciphernode
```
