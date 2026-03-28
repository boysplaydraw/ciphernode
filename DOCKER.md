# CipherNode Docker Kurulum Rehberi

Bu rehber, CipherNode relay sunucusunu Docker ile nasıl kuracaginizi ve yapilandiracaginizi adim adim aciklar.

## Icindekiler

1. [Gereksinimler](#gereksinimler)
2. [Hizli Baslangic](#hizli-baslangic)
3. [Resmi Sunucu Kurulumu](#resmi-sunucu-kurulumu)
4. [Ozel Sunucu Kurulumu](#ozel-sunucu-kurulumu)
5. [Yapilandirma Secenekleri](#yapilandirma-secenekleri)
6. [Guvenlik Onerileri](#guvenlik-onerileri)
7. [Sorun Giderme](#sorun-giderme)

---

## Gereksinimler

- Docker 20.10 veya ustu
- Docker Compose 2.0 veya ustu
- Minimum 256MB RAM
- 1 CPU core

### Docker Kurulumu

**Ubuntu/Debian:**
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

**macOS:**
```bash
brew install --cask docker
```

---

## Hizli Baslangic

En hizli yontem Docker Compose kullanmaktir:

```bash
# Depoyu klonlayin
git clone https://github.com/ciphernode/ciphernode.git
cd ciphernode

# Sunucuyu baslatin
docker compose up -d

# Logları izleyin
docker compose logs -f
```

Sunucu artik `http://localhost:5000` adresinde calisir.

---

## Resmi Sunucu Kurulumu

Resmi CipherNode relay sunucusu, sifir kayit politikasi (no-log) ile calisir.

### Tek Komutla Kurulum

```bash
docker run -d \
  --name ciphernode-relay \
  --restart unless-stopped \
  -p 5000:5000 \
  -e NODE_ENV=production \
  -e MESSAGE_TTL_MS=300000 \
  ghcr.io/ciphernode/relay:latest
```

### Docker Compose ile Kurulum

`docker-compose.yml` dosyasi olusturun:

```yaml
version: '3.8'

services:
  ciphernode-relay:
    image: ghcr.io/ciphernode/relay:latest
    container_name: ciphernode-relay
    restart: unless-stopped
    ports:
      - "5000:5000"
    environment:
      - NODE_ENV=production
      - PORT=5000
      - MESSAGE_TTL_MS=300000
      - CLEANUP_INTERVAL_MS=60000
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:5000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.5'
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp:size=64M,mode=1777
```

Baslatin:
```bash
docker compose up -d
```

---

## Ozel Sunucu Kurulumu

Kendi relay sunucunuzu kaynak koddan derleyerek kurabilirsiniz.

### Adim 1: Kaynak Kodu Indirin

```bash
git clone https://github.com/ciphernode/ciphernode.git
cd ciphernode
```

### Adim 2: Docker Image Olusturun

```bash
docker build -t ciphernode-relay:custom .
```

### Adim 3: Container Baslatin

```bash
docker run -d \
  --name my-ciphernode-relay \
  --restart unless-stopped \
  -p 5000:5000 \
  -e NODE_ENV=production \
  -e MESSAGE_TTL_MS=600000 \
  ciphernode-relay:custom
```

### Adim 4: Dogrulama

```bash
# Sunucu durumunu kontrol edin
curl http://localhost:5000/api/health

# Loglari goruntuleyin
docker logs -f my-ciphernode-relay
```

---

## Yapilandirma Secenekleri

### Cevre Degiskenleri

| Degisken | Varsayilan | Aciklama |
|----------|------------|----------|
| `PORT` | `5000` | Sunucu portu |
| `NODE_ENV` | `production` | Calisma ortami |
| `MESSAGE_TTL_MS` | `300000` | Mesaj yasam suresi (5 dakika) |
| `CLEANUP_INTERVAL_MS` | `60000` | Temizlik araligi (1 dakika) |

### Ornek Yapilandirmalar

**Daha uzun mesaj saklama (30 dakika):**
```bash
docker run -d \
  --name ciphernode-relay \
  -p 5000:5000 \
  -e MESSAGE_TTL_MS=1800000 \
  -e CLEANUP_INTERVAL_MS=120000 \
  ghcr.io/ciphernode/relay:latest
```

**Farkli port kullanimi:**
```bash
docker run -d \
  --name ciphernode-relay \
  -p 8080:5000 \
  -e PORT=5000 \
  ghcr.io/ciphernode/relay:latest
```

---

## Guvenlik Onerileri

### 1. Reverse Proxy Kullanin

Nginx ile SSL/TLS terminasyonu:

```nginx
server {
    listen 443 ssl http2;
    server_name relay.example.com;

    ssl_certificate /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 2. Firewall Kurallari

```bash
# Sadece gerekli portlari acin
sudo ufw allow 443/tcp
sudo ufw allow 80/tcp
sudo ufw deny 5000/tcp
```

### 3. Docker Guvenlik Ayarlari

```yaml
services:
  ciphernode-relay:
    security_opt:
      - no-new-privileges:true
    read_only: true
    cap_drop:
      - ALL
    user: "1001:1001"
```

### 4. Log Rotasyonu

```yaml
services:
  ciphernode-relay:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

---

## Sorun Giderme

### Container Baslamiyor

```bash
# Loglari kontrol edin
docker logs ciphernode-relay

# Container durumunu kontrol edin
docker ps -a | grep ciphernode
```

### Port Cakismasi

```bash
# Hangi surec portu kullaniyor?
lsof -i :5000

# Farkli port kullanin
docker run -p 5001:5000 ...
```

### Bellek Yetersizligi

```bash
# Kaynak kullanimini kontrol edin
docker stats ciphernode-relay

# Bellek limitini artirin
docker run -m 512m ...
```

### Saglik Kontrolu Basarisiz

```bash
# Manuel kontrol
curl http://localhost:5000/api/health

# Container icinden kontrol
docker exec ciphernode-relay wget -q --spider http://localhost:5000/api/health
```

---

## SSL/TLS ile Tam Kurulum Ornegi

### Traefik + Let's Encrypt

```yaml
version: '3.8'

services:
  traefik:
    image: traefik:v2.10
    command:
      - "--providers.docker=true"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.tlschallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.email=admin@example.com"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
    ports:
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - letsencrypt:/letsencrypt

  ciphernode-relay:
    image: ghcr.io/ciphernode/relay:latest
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.ciphernode.rule=Host(`relay.example.com`)"
      - "traefik.http.routers.ciphernode.tls.certresolver=letsencrypt"
      - "traefik.http.services.ciphernode.loadbalancer.server.port=5000"
    environment:
      - NODE_ENV=production
      - MESSAGE_TTL_MS=300000

volumes:
  letsencrypt:
```

---

## Destek

- GitHub Issues: https://github.com/ciphernode/ciphernode/issues
- Dokumantasyon: https://github.com/ciphernode/ciphernode#readme

---

**Lisans:** GPLv3

CipherNode - Privacy-first, end-to-end encrypted messaging
