# CipherNode — Docker Kurulum Rehberi

Bu rehber CipherNode relay sunucusunu Docker ile kurmayı anlatır.  
**3 yöntem var** — ihtiyacınıza göre birini seçin:

| Yöntem | Açıklama | Zorluk |
|--------|----------|--------|
| [Yöntem 1 — Hızlı Başlangıç](#yöntem-1--hızlı-başlangıç) | Tek komutla çalıştır (PostgreSQL dahil) | Kolay |
| [Yöntem 2 — Özelleştirmeli Kurulum](#yöntem-2--özelleştirmeli-kurulum) | .env ile yapılandır, SSL ayarla | Orta |
| [Yöntem 3 — Kaynak Koddan Derle](#yöntem-3--kaynak-koddan-derle) | Kendi image'ını oluştur | İleri |

---

## Gereksinimler

- **Docker 24+** ve **Docker Compose v2+**
- Minimum 256 MB RAM, 1 CPU
- 443 ve 80 portları açık (HTTPS kullanıyorsanız)

### Docker Kurulumu

**Ubuntu / Debian / Raspberry Pi:**
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Oturumu kapatıp açın (grup değişikliği için)
```

**macOS:**
```bash
brew install --cask docker
```

**Windows:**  
[Docker Desktop](https://www.docker.com/products/docker-desktop/) indirip kurun.

---

## Yöntem 1 — Hızlı Başlangıç

En hızlı yol. PostgreSQL dahil, tek komutla her şey ayağa kalkar.

### Adım 1: docker-compose.yml İndir

```bash
curl -O https://raw.githubusercontent.com/boysplaydraw/ciphernode/master/docker-compose.yml
curl -O https://raw.githubusercontent.com/boysplaydraw/ciphernode/master/.env.example
```

### Adım 2: Başlat

```bash
docker compose up -d
```

### Adım 3: Çalıştığını Doğrula

```bash
# Sağlık kontrolü
curl http://localhost:5000/api/health
# Beklenen: {"status":"ok","timestamp":...}

# Logları izle
docker compose logs -f ciphernode-relay
```

Sunucu `http://localhost:5000` adresinde çalışıyor.

> **Not:** İlk başlatmada Docker Hub'dan image indirilir (~1-2 dakika).

---

## Yöntem 2 — Özelleştirmeli Kurulum

Kendi veritabanınızı kullanmak, SSL açmak veya ayarları değiştirmek için.

### Adım 1: Dosyaları İndir

```bash
curl -O https://raw.githubusercontent.com/boysplaydraw/ciphernode/master/docker-compose.yml
curl -O https://raw.githubusercontent.com/boysplaydraw/ciphernode/master/.env.example
cp .env.example .env
```

### Adım 2: .env Dosyasını Düzenle

```bash
nano .env   # veya: notepad .env (Windows)
```

Minimum değiştirmeniz gereken satır:
```env
# Güçlü bir şifre girin
DB_PASSWORD=guclu_bir_sifre_girin
```

### Adım 3: Başlat

```bash
docker compose up -d
```

### Adım 4: Veritabanı Şemasını Kur

İlk kurulumda veritabanı tablolarını oluşturun:

```bash
# Geçici container ile şema push
docker run --rm \
  --network ciphernode_ciphernode-network \
  -e DATABASE_URL="postgresql://ciphernode:${DB_PASSWORD:-ciphernode_secret}@db:5432/ciphernode" \
  mero003/ciphernode:latest \
  sh -c "cd /app && npx drizzle-kit push --config=drizzle.config.ts" 2>/dev/null \
  || echo "Şema zaten mevcut veya sunucu otomatik oluşturdu"
```

> **Not:** Sunucu ilk bağlantıda tabloları otomatik oluşturmaya çalışır.  
> Bu adım başarısız olursa endişelenmeyin — logları kontrol edin.

### Adım 5: Doğrula

```bash
curl http://localhost:5000/api/health
```

---

## SSL Ayarları

Üç seçenek var. İhtiyacınıza göre birini seçin:

---

### Seçenek A — Self-Signed (Yerel / Test)

Hiçbir şey yapmanıza gerek yok. `.env` dosyasında `HTTPS=true` yeterliyse sunucu başlangıçta otomatik olarak kendinden imzalı sertifika üretir.

```env
HTTPS=true
# SSL_DOMAIN satırını boş bırakın
```

**Tarayıcı uyarısı:** "Güvenli Değil" diyecektir — bu normaldir.
- Chrome/Edge → *Gelişmiş* → *yine de devam et*
- Firefox → *Riski Kabul Et ve Devam Et*

---

### Seçenek B — Let's Encrypt (Gerçek Domain)

Gerçek bir SSL sertifikası için certbot ayrı bir container olarak çalışır.  
Relay sunucusu sertifikayı paylaşılan volume üzerinden okur.

**Gereksinimler:**
- `relay.example.com` DNS'te bu sunucuya yönlendirilmiş olmalı
- Port 80 internetten erişilebilir olmalı (sertifika doğrulaması için)

**Adım 1 — .env dosyasını düzenle:**
```env
HTTPS=true
SSL_DOMAIN=relay.example.com
SSL_EMAIL=admin@relay.example.com
```

**Adım 2 — Sertifika al (ilk kurulumda bir kez):**
```bash
# Relay durdurulmuşsa veya henüz çalışmıyorsa (port 80 boş olmalı):
docker compose --profile ssl run --rm certbot
```

Başarılı çıktı:
```
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/relay.example.com/fullchain.pem
Key is saved at:         /etc/letsencrypt/live/relay.example.com/privkey.pem
```

**Adım 3 — Sunucuyu başlat:**
```bash
docker compose up -d
```

Sunucu `/etc/letsencrypt/live/relay.example.com/` konumunu otomatik okur.

**Sertifika yenileme (her ~60 günde bir):**
```bash
# Relay'i geçici durdur (port 80 için)
docker compose stop ciphernode-relay

# Certbot yenile
docker compose --profile ssl run --rm certbot

# Relay'i yeniden başlat
docker compose start ciphernode-relay
```

> **Not:** Let's Encrypt sertifikaları 90 gün geçerlidir.  
> Tarayıcınızda `NET::ERR_CERT_DATE_INVALID` hatası alırsanız yenileme zamanı gelmiş demektir.

---

### Seçenek C — HTTP (Nginx / Traefik Arkasında)

Sunucunuzda zaten bir reverse proxy SSL'i yönetiyorsa:

```env
HTTPS=false
PORT=5000
```

Nginx yapılandırması için [aşağıya bakın](#nginx-ile-reverse-proxy-opsiyonel).

---

## Yöntem 3 — Kaynak Koddan Derle

Kodu değiştirmek veya kendi image'ınızı oluşturmak için.

### Adım 1: Kodu İndir

```bash
git clone https://github.com/boysplaydraw/ciphernode.git
cd ciphernode
```

### Adım 2: Image Derle

```bash
docker build -t ciphernode:custom .
```

Build aşamaları (yaklaşık 2-3 dakika):
```
[1/3] deps    → Production bağımlılıkları kurulur
[2/3] builder → TypeScript derlenir, server bundle oluşturulur
[3/3] runner  → Küçük, güvenli final image hazırlanır
```

### Adım 3: Çalıştır

```bash
# docker-compose.yml'deki image satırını değiştirin:
# image: mero003/ciphernode:latest
# →
# image: ciphernode:custom

docker compose up -d
```

Veya doğrudan:
```bash
docker run -d \
  --name ciphernode-relay \
  --restart unless-stopped \
  -p 5000:5000 \
  -e HTTPS=false \
  -e DATABASE_URL=postgresql://user:pass@host:5432/ciphernode \
  ciphernode:custom
```

---

## Tüm Ortam Değişkenleri

| Değişken | Varsayılan | Açıklama |
|----------|------------|----------|
| `PORT` | `5000` | HTTP sunucu portu |
| `HOST` | `0.0.0.0` | Dinleme adresi |
| `NODE_ENV` | `production` | Çalışma ortamı |
| `DATABASE_URL` | — | **Zorunlu.** PostgreSQL bağlantı adresi |
| `DB_PASSWORD` | `ciphernode_secret` | Compose içi PostgreSQL şifresi |
| `HTTPS` | `true` | `false` → HTTP modu |
| `SSL_DOMAIN` | boş | Domain varsa Let's Encrypt, yoksa self-signed |
| `SSL_EMAIL` | boş | Let's Encrypt için e-posta |
| `SSL_PORT` | `443` | HTTPS portu |
| `HTTP_REDIRECT_PORT` | `80` | HTTP → HTTPS yönlendirme portu |
| `MESSAGE_TTL_MS` | `86400000` | Mesaj ömrü (ms). 86400000 = 24 saat |
| `FILE_TTL_MS` | `86400000` | Dosya ömrü (ms) |
| `MAX_FILE_SIZE_MB` | `100` | Maksimum yükleme boyutu |
| `MAX_FILE_DOWNLOADS` | `10` | Dosya başına indirme limiti |
| `TOR_ENABLED` | `false` | Tor hidden service aktif et |
| `ONION_ADDRESS` | boş | .onion adresi (gösterim amaçlı) |

---

## Günlük Yönetim

```bash
# Servisleri başlat
docker compose up -d

# Servisleri durdur
docker compose down

# Logları izle (canlı)
docker compose logs -f

# Sadece relay logları
docker compose logs -f ciphernode-relay

# Servis durumu
docker compose ps

# Relay container'a gir
docker compose exec ciphernode-relay sh

# Image güncelle (yeni sürüm çek)
docker compose pull
docker compose up -d

# Her şeyi sil (veriler dahil — dikkat!)
docker compose down -v
```

---

## Sorun Giderme

### Container Başlamıyor

```bash
# Hata loglarını gör
docker compose logs ciphernode-relay

# Tüm container'ların durumu
docker compose ps -a
```

Sık karşılaşılan hatalar:
- `DATABASE_URL connection refused` → `db` servisi henüz hazır değil, 30 saniye bekleyip tekrar deneyin
- `EADDRINUSE` → 5000/443/80 portu başka bir uygulama kullanıyor

### Port Çakışması

```bash
# Hangi uygulama 443'ü kullanıyor?
sudo lsof -i :443       # Linux/macOS
netstat -ano | findstr :443  # Windows

# Farklı port kullan
SSL_PORT=8443 HTTP_REDIRECT_PORT=8080 PORT=5001 docker compose up -d
```

### Veritabanı Bağlanamıyor

```bash
# db servisinin sağlıklı olup olmadığını kontrol et
docker compose ps db

# db container'ına bağlan ve test et
docker compose exec db psql -U ciphernode -d ciphernode -c "\dt"
```

### SSL Sertifikası Hatası

```bash
# Mevcut sertifikayı sil (yenisi otomatik oluşturulur)
docker compose down
docker volume rm ciphernode_ciphernode-ssl
docker compose up -d
```

### Bellek / CPU Sorunu

```bash
# Anlık kaynak kullanımı
docker stats

# docker-compose.yml'de limitleri artır:
# deploy.resources.limits.memory: 1G
```

---

## Nginx ile Reverse Proxy (Opsiyonel)

Sunucunuzda zaten Nginx varsa ve CipherNode'u bir subdomain'e almak istiyorsanız:

```nginx
server {
    listen 443 ssl http2;
    server_name relay.example.com;

    ssl_certificate     /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;

        # WebSocket desteği (Socket.IO için zorunlu)
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 86400;
    }
}

server {
    listen 80;
    server_name relay.example.com;
    return 301 https://$host$request_uri;
}
```

Bu durumda `.env` dosyasında `HTTPS=false` yapın (SSL Nginx'te sonlanır).

---

## Destek

- **GitHub Issues:** https://github.com/boysplaydraw/ciphernode/issues
- **Docker Hub:** https://hub.docker.com/r/mero003/ciphernode
