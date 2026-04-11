# CipherNode

**Uçtan uca şifreli, Tor destekli, iz bırakmayan mesajlaşma relay sunucusu.**

- OpenPGP RSA-4096 şifreleme
- Tor / .onion desteği
- Sıfır log — mesajlar RAM'de tutulur, iletimden sonra silinir
- Otomatik SSL (Let's Encrypt veya self-signed)
- P2P mesh ağı (Nostr + WebRTC)

🌐 [cipher-node.site](https://cipher-node.site) &nbsp;·&nbsp; ⭐ [GitHub](https://github.com/boysplaydraw/ciphernode)

---

## Hızlı Başlangıç

```bash
docker run -d \
  -p 443:443 -p 80:80 -p 5000:5000 \
  --restart unless-stopped \
  mero003/ciphernode:latest
```

Otomatik self-signed SSL üretilir. Tarayıcıdan `https://sunucu-ip/app` ile bağlanabilirsiniz.

## Domain + Let's Encrypt

```bash
docker run -d \
  -p 443:443 -p 80:80 \
  -e SSL_DOMAIN=relay.example.com \
  -e SSL_EMAIL=admin@example.com \
  --restart unless-stopped \
  -v ciphernode-ssl:/app/ssl \
  mero003/ciphernode:latest
```

## Docker Compose

```bash
curl -O https://raw.githubusercontent.com/boysplaydraw/ciphernode/master/docker-compose.yml
docker compose up -d
```

## Ortam Değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `5000` | Sunucu portu |
| `HTTPS` | `true` | HTTPS aktif/pasif |
| `SSL_DOMAIN` | — | Let's Encrypt domain |
| `SSL_EMAIL` | — | Let's Encrypt e-posta |
| `SSL_PORT` | `443` | HTTPS portu |
| `MESSAGE_TTL_MS` | `86400000` | Mesaj yaşam süresi (ms) |
| `MAX_FILE_SIZE_MB` | `100` | Maks. dosya boyutu |
| `TOR_ENABLED` | `false` | Tor Hidden Service |

## İstemci Uygulamaları

| Platform | İndir |
|---|---|
| Android | [APK](https://github.com/boysplaydraw/ciphernode/releases/latest/download/CipherNode.apk) |
| Windows | [Setup .exe](https://github.com/boysplaydraw/ciphernode/releases/latest/download/CipherNode.Setup.1.0.0.exe) |
| macOS | [DMG arm64](https://github.com/boysplaydraw/ciphernode/releases/latest/download/CipherNode-1.0.0-arm64.dmg) |
| Linux | [AppImage](https://github.com/boysplaydraw/ciphernode/releases/latest/download/CipherNode-1.0.0.AppImage) |
