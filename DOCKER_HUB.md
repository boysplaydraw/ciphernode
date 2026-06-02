# CipherNode

**Uçtan uca şifreli, Tor destekli, iz bırakmayan mesajlaşma. Tek Docker imajında web arayüzü + relay server.**

- OpenPGP RSA-4096 şifreleme
- Tor / .onion desteği
- Sıfır log — mesajlar RAM'de tutulur, iletimden sonra silinir
- Tek paket: `/app` web arayüzü ve aynı container içinde API/WebSocket relay
- Otomatik SSL (Let's Encrypt veya self-signed)
- P2P mesh ağı (Nostr + WebRTC)
- Android terminal emulatoru Termux için rootsuz paket desteği

🌐 [cipher-node.site](https://cipher-node.site) &nbsp;·&nbsp; ⭐ [GitHub](https://github.com/boysplaydraw/ciphernode)

---

## Hızlı Başlangıç

```bash
docker run -d \
  --name ciphernode \
  -p 443:443 -p 80:80 -p 5000:5000 \
  --restart unless-stopped \
  mero003/ciphernode:latest
```

Tarayıcıdan `http://sunucu-ip:5000/app` veya HTTPS açıksa `https://sunucu-ip/app` ile bağlanabilirsiniz.

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

## Termux Android Terminal Emulator + HTTPS Tunnel

```bash
curl -LO https://github.com/boysplaydraw/ciphernode/releases/latest/download/ciphernode-termux.tar.gz
tar -xzf ciphernode-termux.tar.gz
cd ciphernode-termux
bash termux-start.sh
```

Termux bir Android terminal emulatorudur; root gerekmez. Varsayılan port `5000`: `http://telefon-ip:5000/app`.

HTTPS gerekiyorsa:

```bash
bash termux-start.sh cloudflare
```

Script `https://...trycloudflare.com/app` adresi üretir.

## Legal

- Privacy Policy: https://cipher-node.site/privacy
- Terms of Service: https://cipher-node.site/terms
- License: GPLv3

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
| `ONION_ADDRESS` | — | Harici Tor hidden service adresi |

## İstemci Uygulamaları

| Platform | İndir |
|---|---|
| Android | [APK](https://github.com/boysplaydraw/ciphernode/releases/latest/download/CipherNode.apk) |
| Windows | [Setup .exe](https://github.com/boysplaydraw/ciphernode/releases/latest/download/CipherNode.Setup.1.0.0.exe) |
| macOS | [DMG arm64](https://github.com/boysplaydraw/ciphernode/releases/latest/download/CipherNode-1.0.0-arm64.dmg) |
| Linux | [AppImage](https://github.com/boysplaydraw/ciphernode/releases/latest/download/CipherNode-1.0.0.AppImage) |
