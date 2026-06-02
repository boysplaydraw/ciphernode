# CipherNode Termux

CipherNode Android terminal emulatoru olan Termux uzerinde root olmadan calisabilir. Paket web arayuzunu ve relay server'i ayni klasorde tasir.

## Hazir Paket

Windows uzerinde paketi olustur:

```powershell
powershell -File scripts\build-termux-package.ps1
```

Olusan dosya:

```text
termux-package/ciphernode-termux.tar.gz
```

Termux'ta calistir:

```sh
pkg update
pkg install -y nodejs tar
tar -xzf ciphernode-termux.tar.gz
cd ciphernode-termux
bash termux-start.sh
```

Web arayuzu:

```text
http://localhost:5000/app
http://TELEFON_IP:5000/app
```

## HTTPS Tunnel

Mobil/web baglantisi HTTPS istiyorsa root gerektirmeyen Cloudflare Tunnel kullanin:

```sh
bash termux-start.sh cloudflare
```

Script bir `https://...trycloudflare.com/app` adresi yazdirir.

Alternatif olarak LocalTunnel denenebilir:

```sh
bash termux-start.sh localtunnel
```

## Tor

```sh
bash termux-start.sh tor
```

Tor hidden service `.onion` adresi HTTP olarak calisir. Normal tarayici veya mobil uygulama HTTPS zorunluysa Cloudflare Tunnel modunu kullanin.

Root gerekmez. Dusuk portlar Android rootless ortamda kullanilamadigi icin varsayilan port `5000` olarak kalir.
