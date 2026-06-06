# CipherNode — Codex Agent Talimatları

## Proje Özeti
E2EE mesajlaşma uygulaması. GPLv3. Docker: mero003/ciphernode.
Stack: React Native + Expo, Express/Node.js (→Go), Electron (→Tauri), openpgp.js, Socket.io, PostgreSQL.

## YASAK İŞLEMLER — HİÇBİR KOŞULDA YAPMA
- openpgp.js çağrılarını değiştirme
- Math.random() ile crypto işlemi yapma
- P2P/WebRTC koduna dokunma
- Private key'i console.log ile yazdırma
- IV/nonce'u sabit değer olarak set etme
- node_modules'e elle müdahale etme

## GÖREV KURALLARI
- Her görevde sadece istenen dosyaları değiştir
- Mevcut TypeScript tiplerini koru
- Yeni bağımlılık ekleyeceksen önce package.json'ı kontrol et
- Test yoksa oluşturma (henüz test altyapısı yok)
- Her değişiklikten sonra `npm run check:types` çalıştır

## DOSYA HARİTASI
```
server/
  index.ts          ← Express + Socket.io giriş noktası
  routes/           ← API endpoint'leri
  middleware/       ← Auth, rate limit (eklenecek)
  db/               ← Drizzle schema

client/
  screens/          ← Ekranlar
  components/       ← UI bileşenleri
  lib/
    crypto.ts       ← ŞİFRELEME — DİKKATLİ OL
    storage.ts      ← AsyncStorage/IndexedDB
    api.ts          ← Server iletişimi

electron/
  main.ts           ← Electron main process
  tor-manager.ts    ← Tor entegrasyonu
  preload.ts        ← IPC bridge

.github/workflows/  ← CI/CD (oluşturulacak)
```

## GÖREV LİSTESİ — SIRAYLA İŞLE

### GÖREV 1 — .env.example güncelle
Dosya: `.env.example`
Değişiklik: SESSION_SECRET satırını şu şekilde güncelle:
```
# ÖNEMLİ: Aşağıdaki değeri MUTLAKA değiştir!
# Üretmek için: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=BURAYA_EN_AZ_32_KARAKTER_RASTGELE_STRING_YAZ
```

### GÖREV 2 — Rate limiting middleware
Yeni dosya: `server/middleware/rateLimit.ts`
```typescript
import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

export const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { error: 'Message rate limit exceeded.' }
});

export const identityLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Identity creation rate limit exceeded.' }
});
```
Sonra `server/index.ts`'de import edip route'lara ekle.
`express-rate-limit` package.json'da yoksa `npm install express-rate-limit` çalıştır.

### GÖREV 3 — Dockerfile düzelt
Dosya: `Dockerfile`
- `LABEL org.opencontainers.image.licenses="MIT"` → `"GPL-3.0"` yap
- HEALTHCHECK'i şununla değiştir:
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT||5000) + '/api/health', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
```

### GÖREV 4 — .gitignore güncelle
Dosya: `.gitignore`
Şunları ekle:
```
.replit
replit.md
.cache/
```

### GÖREV 5 — Stats endpoint
Dosya: `server/routes/stats.ts` (yeni oluştur)
```typescript
import { Router } from 'express';
import { Server } from 'socket.io';

export function createStatsRouter(io: Server) {
  const router = Router();

  router.get('/stats', (req, res) => {
    res.json({
      online: io.engine.clientsCount,
      uptime: Math.floor(process.uptime()),
      version: process.env.npm_package_version || '1.0.0'
    });
  });

  return router;
}
```
`server/index.ts`'e import et ve `app.use('/api', createStatsRouter(io))` ekle.

### GÖREV 6 — Private key backup şifreleme
Dosya: `client/lib/identity.ts` veya ilgili dosya
Export fonksiyonunda düz JSON yerine AES-256-GCM ile şifrele:
```typescript
import * as Crypto from 'expo-crypto';

export async function exportIdentityEncrypted(
  identity: Identity,
  password: string
): Promise<string> {
  const salt = await Crypto.getRandomBytesAsync(16);
  // PBKDF2 ile anahtar türet
  // AES-256-GCM ile şifrele
  // salt + iv + ciphertext birleştir, base64 döndür
}

export async function importIdentityEncrypted(
  encryptedData: string,
  password: string
): Promise<Identity> {
  // base64 çöz, salt/iv/ciphertext ayır
  // PBKDF2 ile anahtar türet
  // AES-256-GCM ile decrypt et
}
```
`expo-crypto` zaten package.json'da mevcut.

### GÖREV 7 — GitHub Actions workflow
Yeni dosya: `.github/workflows/release.yml`
Tetikleyici: `v*` tag push veya manual workflow_dispatch (version input ile)
Jobs:
1. `android` → EAS Build production APK (EXPO_TOKEN secret)
2. `electron-windows` → windows-latest, `npm run electron:win`
3. `electron-linux` → ubuntu-latest, `npm run electron:linux`
4. `electron-macos` → macos-latest, `npm run electron:mac`
5. `docker` → buildx multi-arch (linux/amd64 + linux/arm64), Docker Hub push (mero003/ciphernode:latest + version tag)
6. `release` → tüm artifact'ları topla, GitHub Release oluştur

### GÖREV 8 — All-in-one Dockerfile
Yeni dosya: `Dockerfile.allinone`
Mevcut Dockerfile'ı baz al, builder aşamasına ekle:
```dockerfile
COPY client ./client
COPY assets ./assets
COPY app.json ./
RUN npx expo export --platform web --output-dir web_dist
```
Runner'a ekle:
```dockerfile
COPY --from=builder /app/web_dist ./web_dist
```
Server'da `/app` path'inden serve et.

### GÖREV 9 — CasaOS manifest
Yeni dosya: `casaos-app.json`
all-in-one image'ı kullanan CasaOS App Store manifest dosyası.
Port: 5000, image: mero003/ciphernode:all-in-one
Env: NODE_ENV, PORT, HTTPS (default false)

### GÖREV 10 — README güvenlik bölümü
Dosya: `README.md`
"Reporting Security Issues" bölümündeki placeholder email'i:
`support@cipher-node.site` ile değiştir.

## CODEX CLI KULLANIM ÖRNEKLERİ
```bash
# Tek görev çalıştır
codex "GÖREV 2'yi yap — rate limiting middleware ekle"

# Sıralı çalıştır
codex "GÖREV 1, 2 ve 3'ü sırayla yap"

# Spesifik dosya
codex "server/middleware/rateLimit.ts dosyasını GÖREV 2'deki spec'e göre oluştur"

# Kontrol
codex "npm run check:types çalıştır ve hataları düzelt"
```

---

## ALTYAPI BİLGİSİ

| Domain | Nerede | Ne |
|---|---|---|
| cipher-node.site | Hostinger Premium | Landing page — **BİTİŞ: 2026-07-14 ⚠️** |
| appnodes.space | Hostinger Premium | Web app |
| relayworks.xyz | VPS (200 TL/ay) | Relay server + SaaS landing |

## ACİL — HOSTİNG YENİLEME
cipher-node.site hosting 2026-07-14'te bitiyor, otomatik yenileme KAPALI.
Hostinger panelinde manuel yenile veya otomatik yenilemeyi aç.

## GÖREV 11 — Stripe Entegrasyonu
relayworks-landing.html içindeki submitModal() fonksiyonuna Stripe Checkout ekle:
```javascript
async function submitModal() {
  const email = document.getElementById('modal-email').value;
  const plan = document.getElementById('modal-plan').textContent;

  const res = await fetch('/api/create-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, plan })
  });
  const { url } = await res.json();
  window.location.href = url;
}
```

Server tarafında (Go veya Node.js):
- Stripe SDK kur
- /api/create-checkout endpoint oluştur
- Personal plan: price_xxx (5€/ay recurring)
- Team plan: price_yyy (20€/ay recurring)
- Webhook: /api/stripe-webhook — ödeme başarılıysa kullanıcıya relay URL gönder

## NOT: eliteart.com
Eski proje, dokunma. CipherNode odağını dağıtır.
