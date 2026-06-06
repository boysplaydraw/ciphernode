# CipherNode — Claude Code Bağlam Dosyası

## Proje
Açık kaynaklı E2EE mesajlaşma uygulaması. GPLv3.
- Repo: https://github.com/boysplaydraw/ciphernode
- Web App: https://appnodes.space
- Docker: mero003/ciphernode

## Tech Stack
- Frontend: React Native + Expo (iOS/Android/Web)
- Backend: Express + Node.js → Go geçişi devam ediyor
- Desktop: Electron → Tauri geçişi devam ediyor
- Şifreleme: openpgp.js (RSA-4096 + AES-256)
- Realtime: Socket.io
- DB: PostgreSQL + Drizzle ORM

## Mevcut Durum
- ✅ Web app ayrı sunucuda aktif (appnodes.space)
- ✅ Docker image relay server (mero003/ciphernode)
- ✅ 2K+ indirme
- 🔄 Go backend geçişi devam ediyor
- 🔄 Tauri geçişi devam ediyor
- ❌ GitHub Actions yok

## KESİNLİKLE DOKUNMA
- `openpgp.js` şifreleme mantığı — yanlış değişiklik tüm güvenliği bozar
- P2P/WebRTC kodu — deneysel, kasıtlı devre dışı
- Go backend — Node.js ile paralel geliştiriliyor, birini bozma
- Electron kodu — Tauri geçişi bitmedi, ikisini birden bozma

## Öncelikli Görevler
1. SESSION_SECRET uyarısı (.env.example)
2. Rate limiting (server/middleware/rateLimit.ts)
3. Private key backup şifreleme (AES-256-GCM)
4. Dockerfile: lisans GPL-3.0, healthcheck node'a çevir
5. GitHub Actions release workflow
6. All-in-one Docker image + CasaOS manifest
7. Tauri geçişini tamamla
8. Go backend geçişini tamamla

## Kodlama Standartları
- TypeScript strict
- Async/await, callback yok
- Güvenlik fonksiyonlarına JSDoc
- Hata mesajları UI'da Türkçe olabilir, kod içi İngilizce

## Güvenlik Kuralları
- Crypto için her zaman `crypto.randomBytes()` kullan, Math.random() asla
- IV/nonce her şifrelemede yeni üretilmeli
- Private key asla plaintext log'lanmamalı
- Rate limiting olmadan hiçbir endpoint production'a çıkmamalı
