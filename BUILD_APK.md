# APK Oluşturma Rehberi

## Web Crypto API Hatası Düzeltildi

Aşağıdaki düzeltmeler yapıldı:
- `react-native-quick-crypto` eklendi (native crypto desteği)
- `expo-build-properties` eklendi (Android build optimizasyonu)
- Metro config crypto polyfill için güncellendi
- Client index.js crypto kurulumu eklendi

## APK Oluşturma Adımları

### 1. EAS CLI Kurulumu

```bash
npm install -g eas-cli
```

### 2. EAS Hesabı Oluşturma ve Giriş

```bash
eas login
```

Hesabınız yoksa:
```bash
eas register
```

### 3. Projeyi EAS ile Konfigüre Etme

```bash
eas build:configure
```

### 4. APK Build Başlatma

**Test/Preview APK için:**
```bash
npm run build:apk:preview
```

Veya direkt:
```bash
eas build --platform android --profile preview
```

**Production APK için:**
```bash
npm run build:apk:production
```

Veya direkt:
```bash
eas build --platform android --profile production
```

### 5. Build Durumunu Takip Etme

Build başladıktan sonra:
- Terminal'de link gösterilecek
- https://expo.dev üzerinden build durumunu takip edebilirsiniz
- Build tamamlandığında APK dosyasını indirebilirsiniz

### 6. APK İndirme

Build tamamlandığında:
- Expo dashboard'dan direkt indirebilirsiniz
- Veya QR kodu taratıp telefonunuzdan indirebilirsiniz

## Local Development Build (Opsiyonel)

Daha hızlı test için development build:

```bash
eas build --platform android --profile development
```

Bu build Expo Go yerine kendi native kodunuzu içerir ve daha stabil çalışır.

## Önemli Notlar

### Sunucu URL'si
Production build öncesinde `client/lib/query-client.ts` dosyasında `EXPO_PUBLIC_DOMAIN` değişkenini production sunucu adresinize göre ayarlayın.

### Android Permissions
`app.json` dosyasında gerekli izinler zaten ekli:
- Camera (QR tarama için)
- Network (mesajlaşma için)
- Storage (AsyncStorage için)

### Signing Key
İlk build'de EAS otomatik signing key oluşturacak. Bu key'i kaybetmeyin, yoksa uygulama güncellemeleri yapamayacaksınız.

## Build Profilleri

### Preview
- APK formatında
- Internal distribution için
- Hızlı test amaçlı

### Production
- APK veya AAB formatında
- Google Play Store için hazır
- Optimize edilmiş

## Sorun Giderme

### Build Hatası Alırsanız:
1. `node_modules` ve `package-lock.json` silin
2. `npm install` çalıştırın
3. Build'i tekrar deneyin

### Crypto Hatası Devam Ederse:
1. Metro cache'i temizleyin: `npx expo start -c`
2. Projeyi yeniden build edin

### Network Hatası:
1. `client/lib/query-client.ts` dosyasında server URL'ini kontrol edin
2. `EXPO_PUBLIC_DOMAIN` environment variable'ını doğru ayarladığınızdan emin olun

## Test Etme

APK kurduktan sonra:
1. Uygulamayı açın
2. Kimlik otomatik oluşturulacak
3. QR kod ile kişi ekleyin
4. Mesaj göndererek crypto işlevlerini test edin

## Üretim Deployment

Google Play Store'a yüklemek için:
1. Production build oluşturun: `eas build --platform android --profile production`
2. AAB formatını seçin (Play Store gereksinimi)
3. Expo'dan AAB dosyasını indirin
4. Google Play Console'dan yükleyin

## İletişim

Sorularınız için: [GitHub Issues](https://github.com/ciphernode/ciphernode/issues)
