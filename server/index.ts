import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { startTorHiddenService, stopTor, getOnionAddress } from "./tor-hidden-service";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";

const app = express();
const log = console.log;

// AWS ALB, GCloud Load Balancer, Nginx arkasında çalışmak için
app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    // Tüm origin'lere izin ver — local, Docker, Termux, Tor, ngrok, Replit
    const origin = req.header("origin");
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Access-Control-Allow-Credentials", "true");
    } else {
      res.header("Access-Control-Allow-Origin", "*");
    }
    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, bypass-tunnel-reminder, X-Tor-Enabled, X-Tor-Proxy",
    );

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

function setupBodyParsing(app: express.Application) {
  const maxFileSizeMb = parseInt(process.env.MAX_FILE_SIZE_MB || "100", 10);
  app.use(
    express.json({
      limit: `${maxFileSizeMb + 50}mb`,
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false, limit: `${maxFileSizeMb + 50}mb` }));
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;

      const duration = Date.now() - start;

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    });

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveExpoManifest(platform: string, res: Response) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json",
  );

  if (!fs.existsSync(manifestPath)) {
    return res
      .status(404)
      .json({ error: `Manifest not found for platform: ${platform}` });
  }

  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

// Inline landing page template — no external file dependency (works in pkg standalone binary)
const LANDING_PAGE_TEMPLATE = `<!doctype html>
<html>
  <head>
    <title>APP_NAME_PLACEHOLDER</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      * { box-sizing: border-box; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 32px 20px; text-align: center; background: #fff; color: #222; line-height: 1.5; min-height: 100vh; }
      .wrapper { max-width: 480px; margin: 0 auto; }
      h1 { font-size: 26px; font-weight: 600; margin: 0; color: #111; }
      .subtitle { font-size: 15px; color: #666; margin-top: 8px; margin-bottom: 32px; }
      .loading { display: none; margin: 60px 0; }
      .spinner { border: 2px solid #ddd; border-top-color: #333; border-radius: 50%; width: 32px; height: 32px; animation: spin 0.8s linear infinite; margin: 20px auto; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .loading-text { font-size: 16px; color: #444; }
      .content { display: block; }
      .steps-container { display: flex; flex-direction: column; gap: 20px; }
      .step { padding: 24px; border: 1px solid #ddd; border-radius: 12px; text-align: center; background: #fafafa; }
      .step-header { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 12px; }
      .step-number { width: 28px; height: 28px; border: 1px solid #999; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px; flex-shrink: 0; color: #555; }
      .step-title { font-size: 18px; font-weight: 600; margin: 0; color: #222; }
      .step-description { font-size: 14px; margin-bottom: 16px; color: #666; }
      .store-buttons { display: flex; flex-direction: column; gap: 6px; justify-content: center; flex-wrap: wrap; }
      .store-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 20px; font-size: 14px; font-weight: 500; border: 1px solid #ccc; border-radius: 8px; text-decoration: none; color: #333; background: #fff; transition: all 0.15s; }
      .store-button:hover { background: #f5f5f5; border-color: #999; }
      .store-link { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 0; font-size: 13px; text-decoration: underline; text-underline-offset: 2px; color: #666; background: none; border: none; transition: color 0.15s; }
      .store-link:hover { color: #333; }
      .store-icon { width: 18px; height: 18px; }
      .qr-section { background: #333; color: #fff; border-color: #333; }
      .qr-section .step-number { border-color: rgba(255,255,255,.5); color: #fff; }
      .qr-section .step-title { color: #fff; }
      .qr-section .step-description { color: rgba(255,255,255,.7); }
      .qr-code { width: 180px; height: 180px; margin: 0 auto 16px; background: #fff; border-radius: 8px; padding: 12px; }
      .open-button { display: inline-block; padding: 12px 24px; font-size: 14px; font-weight: 500; border: 1px solid rgba(255,255,255,.3); border-radius: 8px; text-decoration: none; color: #333; background: #fff; transition: opacity 0.15s; }
      .open-button:hover { opacity: .9; }
      @media (min-width: 768px) {
        body { padding: 48px 32px; display: flex; align-items: center; justify-content: center; }
        .wrapper { max-width: 720px; }
        h1 { font-size: 32px; margin-bottom: 10px; }
        .subtitle { font-size: 16px; margin-bottom: 40px; }
        .steps-container { flex-direction: row; gap: 20px; align-items: stretch; }
        .step { flex: 1; display: flex; flex-direction: column; padding: 28px; }
        .step-description { flex-grow: 1; }
        .store-buttons { flex-direction: column; gap: 10px; }
        .qr-code { width: 200px; height: 200px; }
      }
      @media (min-width: 1024px) { .wrapper { max-width: 800px; } h1 { font-size: 36px; } .steps-container { gap: 28px; } .step { padding: 32px; } }
      @media (prefers-color-scheme: dark) {
        body { background: #0d0d0d; color: #e0e0e0; }
        h1 { color: #f5f5f5; }
        .subtitle { color: #999; }
        .spinner { border-color: #444; border-top-color: #ccc; }
        .loading-text { color: #aaa; }
        .step { border-color: #333; background: #1a1a1a; }
        .step-number { border-color: #666; color: #bbb; }
        .step-title { color: #f0f0f0; }
        .step-description { color: #888; }
        .store-button { border-color: #444; color: #e0e0e0; background: #222; }
        .store-button:hover { background: #2a2a2a; border-color: #666; }
        .store-link { color: #888; }
        .store-link:hover { color: #ccc; }
        .qr-section { background: #111; border-color: #333; }
        .qr-section .step-number { border-color: rgba(255,255,255,.4); }
        .qr-section .step-description { color: rgba(255,255,255,.6); }
        .open-button { background: #f0f0f0; color: #111; }
        .open-button:hover { background: #e0e0e0; }
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="loading" id="loading"><div class="spinner"></div><div class="loading-text">Opening in Expo Go...</div></div>
      <div class="content" id="content">
        <h1>APP_NAME_PLACEHOLDER</h1>
        <p class="subtitle">Preview this app on your phone</p>
        <div class="steps-container">
          <div class="step">
            <div class="step-header"><div class="step-number">1</div><h2 class="step-title">Download Expo Go</h2></div>
            <p class="step-description">Expo Go is a free app to test mobile apps</p>
            <div class="store-buttons" id="store-buttons">
              <a id="app-store-btn" href="https://apps.apple.com/app/id982107779" class="store-button" target="_blank">
                <svg class="store-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                App Store
              </a>
              <a id="play-store-btn" href="https://play.google.com/store/apps/details?id=host.exp.exponent" class="store-button" target="_blank">
                <svg class="store-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M3,20.5V3.5C3,2.91 3.34,2.39 3.84,2.15L13.69,12L3.84,21.85C3.34,21.6 3,21.09 3,20.5M16.81,15.12L6.05,21.34L14.54,12.85L16.81,15.12M20.16,10.81C20.5,11.08 20.75,11.5 20.75,12C20.75,12.5 20.53,12.9 20.18,13.18L17.89,14.5L15.39,12L17.89,9.5L20.16,10.81M6.05,2.66L16.81,8.88L14.54,11.15L6.05,2.66Z"/></svg>
                Google Play
              </a>
            </div>
          </div>
          <div class="step qr-section">
            <div class="step-header"><div class="step-number">2</div><h2 class="step-title">Scan QR Code</h2></div>
            <p class="step-description">Use your phone's camera or Expo Go</p>
            <div class="qr-code" id="qr-code"></div>
            <a href="exps://EXPS_URL_PLACEHOLDER" class="open-button">Open in Expo Go</a>
          </div>
        </div>
      </div>
    </div>
    <script src="https://unpkg.com/qr-code-styling@1.6.0/lib/qr-code-styling.js"></script>
    <script>
      (function(){
        var ua=navigator.userAgent;
        var loadingEl=document.getElementById("loading");
        var contentEl=document.getElementById("content");
        var isAndroid=/Android/i.test(ua);
        var isIOS=/iPhone|iPad|iPod/i.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
        var deepLink="exps://EXPS_URL_PLACEHOLDER";
        var appStoreBtn=document.getElementById("app-store-btn");
        var playStoreBtn=document.getElementById("play-store-btn");
        var storeButtonsContainer=document.getElementById("store-buttons");
        if(isIOS){playStoreBtn.className="store-link";storeButtonsContainer.appendChild(playStoreBtn);}
        else if(isAndroid){appStoreBtn.className="store-link";storeButtonsContainer.insertBefore(playStoreBtn,appStoreBtn);}
        var qrCode=new QRCodeStyling({width:400,height:400,data:deepLink,image:"assets/images/icon.png",dotsOptions:{color:"#333333",type:"rounded"},backgroundOptions:{color:"#ffffff"},imageOptions:{crossOrigin:"anonymous",margin:6,imageSize:0.35},cornersSquareOptions:{type:"extra-rounded"},cornersDotOptions:{type:"dot"},qrOptions:{errorCorrectionLevel:"H"}});
        qrCode.append(document.getElementById("qr-code"));
        if(isAndroid||isIOS){loadingEl.style.display="block";contentEl.style.display="none";window.location.href=deepLink;setTimeout(function(){loadingEl.style.display="none";contentEl.style.display="block";},500);}
      })();
    </script>
  </body>
</html>`;

function configureExpoAndLanding(app: express.Application) {
  // Use inline template if external file doesn't exist (pkg standalone binary mode)
  const templatePath = path.resolve(process.cwd(), "server", "templates", "landing-page.html");
  const landingPageTemplate = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, "utf-8")
    : LANDING_PAGE_TEMPLATE;
  const appName = getAppName();

  log("Serving static Expo files with dynamic manifest routing");

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) {
      return next();
    }

    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }

    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }

    if (req.path === "/") {
      // Tarayıcıdan geliyorsa (Accept: text/html) marketing sitesini göster
      const websitePath = path.resolve(process.cwd(), "website", "index.html");
      const accept = req.header("accept") || "";
      if (accept.includes("text/html") && fs.existsSync(websitePath)) {
        return res.sendFile(websitePath);
      }
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName,
      });
    }

    next();
  });

  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

  // Web uygulaması (/app) — Expo web export'u serve et
  const webAppDir = path.resolve(process.cwd(), "dist");
  if (fs.existsSync(webAppDir)) {
    app.use("/app", express.static(webAppDir));
    // SPA fallback — tüm /app/* route'larını index.html'e yönlendir
    app.get("/app/*", (_req, res) => {
      res.sendFile(path.join(webAppDir, "index.html"));
    });
    log("Web app served at /app");
  }

  // Marketing website (website/index.html)
  const websiteDir = path.resolve(process.cwd(), "website");
  if (fs.existsSync(websiteDir)) {
    app.use("/website", express.static(websiteDir));
    log("Marketing website served at /website");
  }

  // İndirme dosyaları — dist-electron klasöründen serve et
  const downloadsDir = path.resolve(process.cwd(), "dist-electron");
  if (fs.existsSync(downloadsDir)) {
    app.use("/downloads", express.static(downloadsDir, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".exe")) {
          res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
          res.setHeader("Content-Type", "application/octet-stream");
        }
      },
    }));
    log("Downloads served at /downloads");
  }

  log("Expo routing: Checking expo-platform header on / and /manifest");
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";

    res.status(status).json({ message });

    throw err;
  });
}

/**
 * SSL sertifikası yollarını çöz.
 *
 * Öncelik sırası:
 *  1. SSL_CERT + SSL_KEY env (Docker entrypoint tarafından set edilir)
 *  2. .env dosyası (Windows setup scripti tarafından yazılır)
 *  3. Docker volume: /app/ssl/cert.pem + /app/ssl/key.pem
 *  4. Linux certbot: /etc/letsencrypt/live/<domain>/
 *  5. Windows win-acme: %ProgramData%\CipherNode\ssl\
 *
 * HTTPS=false ise null döner → HTTP modu
 */
function resolveSSLPaths(): { cert: string; key: string } | null {
  // HTTPS açıkça devre dışı bırakılmışsa HTTP modu
  if (process.env.HTTPS === "false") {
    log("[SSL] HTTPS=false — HTTP modunda çalışılıyor.");
    return null;
  }

  // .env dosyasından yükle (yoksa env'den al)
  if (fs.existsSync(path.resolve(process.cwd(), ".env"))) {
    try {
      const envContent = fs.readFileSync(path.resolve(process.cwd(), ".env"), "utf-8");
      for (const line of envContent.split("\n")) {
        const eqIdx = line.indexOf("=");
        if (eqIdx < 0) continue;
        const k = line.slice(0, eqIdx).trim();
        const v = line.slice(eqIdx + 1).trim();
        if (k === "SSL_CERT"   && !process.env.SSL_CERT)   process.env.SSL_CERT   = v;
        if (k === "SSL_KEY"    && !process.env.SSL_KEY)    process.env.SSL_KEY    = v;
        if (k === "SSL_DOMAIN" && !process.env.SSL_DOMAIN) process.env.SSL_DOMAIN = v;
      }
    } catch { /* .env okuma hatası — sessizce geç */ }
  }

  const cert = process.env.SSL_CERT;
  const key  = process.env.SSL_KEY;
  const dom  = process.env.SSL_DOMAIN;

  // 1. Açık yollar (Docker entrypoint veya .env tarafından set edilmiş)
  if (cert && key) {
    if (fs.existsSync(cert) && fs.existsSync(key)) {
      log(`[SSL] Sertifika yüklendi: ${cert}`);
      return { cert, key };
    }
    log(`[SSL] UYARI: SSL_CERT/SSL_KEY bulunamadı → HTTP moduna geçiliyor.`);
    return null;
  }

  // 2. Docker volume konumu (/app/ssl/)
  const dockerCert = "/app/ssl/cert.pem";
  const dockerKey  = "/app/ssl/key.pem";
  if (fs.existsSync(dockerCert) && fs.existsSync(dockerKey)) {
    log(`[SSL] Docker volume sertifikası kullanılıyor: ${dockerCert}`);
    return { cert: dockerCert, key: dockerKey };
  }

  if (dom) {
    // 3. Linux certbot
    const leCert = `/etc/letsencrypt/live/${dom}/fullchain.pem`;
    const leKey  = `/etc/letsencrypt/live/${dom}/privkey.pem`;
    if (fs.existsSync(leCert) && fs.existsSync(leKey)) {
      log(`[SSL] Let's Encrypt sertifikası kullanılıyor: ${dom}`);
      return { cert: leCert, key: leKey };
    }

    // 4. Windows win-acme
    const winData  = process.env.ProgramData || "C:\\ProgramData";
    const winSslDir = path.join(winData, "CipherNode", "ssl");
    if (fs.existsSync(winSslDir)) {
      const files    = fs.readdirSync(winSslDir);
      const certFile = files.find((f) =>
        f.includes(dom) && (f.includes("chain") || f.includes("cert")) && f.endsWith(".pem")
      ) || files.find((f) => f.endsWith(".pem") && !f.includes("key"));
      const keyFile  = files.find((f) =>
        f.includes(dom) && f.includes("key") && f.endsWith(".pem")
      ) || files.find((f) => f.includes("key") && f.endsWith(".pem"));

      if (certFile && keyFile) {
        return {
          cert: path.join(winSslDir, certFile),
          key:  path.join(winSslDir, keyFile),
        };
      }
    }

    log(`[SSL] '${dom}' için sertifika bulunamadı.`);
    log(`[SSL]   Linux  : sudo bash scripts/setup-ssl.sh ${dom}`);
    log(`[SSL]   Windows: powershell -File scripts\\setup-ssl-windows.ps1 -Domain ${dom}`);
    log(`[SSL]   Docker : SSL_DOMAIN=${dom} docker compose up`);
  }

  // HTTPS=true ama sertifika yok → HTTP moduna düş (Docker dışında)
  if (process.env.HTTPS === "true") {
    log("[SSL] HTTPS=true ama sertifika bulunamadı — HTTP moduna geçiliyor.");
    log("[SSL] Docker'da bu normal değil; entrypoint script çalıştı mı?");
  }

  return null;
}

(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);

  configureExpoAndLanding(app);

  const port = parseInt(process.env.PORT || "5000", 10);
  // 0.0.0.0: Docker container, Termux, LAN ve Tor hidden service erişimi için
  const host = process.env.HOST || "0.0.0.0";

  const sslPaths = resolveSSLPaths();

  if (sslPaths) {
    // ── HTTPS modu: Let's Encrypt / özel sertifika ──────────────────────
    const tlsOptions = {
      cert: fs.readFileSync(sslPaths.cert),
      key: fs.readFileSync(sslPaths.key),
    };

    // HTTPS sunucusunu önce oluştur; socket.io bu sunucuya bağlanır
    const httpsPort = parseInt(process.env.SSL_PORT || "443", 10);
    const httpsServer = https.createServer(tlsOptions, app);

    // registerRoutes'a HTTPS sunucusunu ver (socket.io üzerine eklenir)
    await registerRoutes(app, httpsServer as any);

    setupErrorHandler(app);

    httpsServer.listen(httpsPort, host, () => {
      log(`[SSL] HTTPS sunucusu ${host}:${httpsPort} üzerinde çalışıyor`);
    });

    // HTTP → HTTPS yönlendirme sunucusu (port 80)
    const redirectApp = express();
    redirectApp.use((req: Request, res: Response) => {
      const sslDomain = process.env.SSL_DOMAIN || req.headers.host?.replace(/:\d+$/, "") || "";
      // Let's Encrypt ACME doğrulaması için bypass
      if (req.path.startsWith("/.well-known/acme-challenge/")) {
        const challengePath = path.resolve(process.cwd(), "var", "www", "certbot", req.path);
        if (fs.existsSync(challengePath)) {
          return res.sendFile(challengePath);
        }
      }
      res.redirect(301, `https://${sslDomain}${req.url}`);
    });

    const httpRedirectPort = parseInt(process.env.HTTP_REDIRECT_PORT || "80", 10);
    http.createServer(redirectApp).listen(httpRedirectPort, host, () => {
      log(`[SSL] HTTP→HTTPS yönlendirme sunucusu port ${httpRedirectPort} üzerinde çalışıyor`);
    });

    log(`[SSL] Sertifika: ${sslPaths.cert}`);
    log(`[SSL] İpucu: Certbot otomatik yenileme için 'sudo certbot renew --quiet' cron'a ekleyin.`);
  } else {
    // ── HTTP modu (varsayılan) ────────────────────────────────────────────
    const server = await registerRoutes(app);

    setupErrorHandler(app);

    server.listen(port, host, async () => {
      log(`express server serving on ${host}:${port}`);
      if (process.env.SSL_DOMAIN) {
        log(`[SSL] SSL etkinleştirmek için: sudo bash scripts/setup-ssl.sh ${process.env.SSL_DOMAIN}`);
      }

      // ── Opsiyonel Tor Hidden Service ──────────────────────────────────
      // TOR_ENABLED=true veya ONION_ADDRESS env var ile aktif olur
      if (process.env.TOR_ENABLED === "true" || process.env.ONION_ADDRESS) {
        const onion = await startTorHiddenService(port);
        if (onion) {
          log(`[Tor] Hidden service aktif: http://${onion}`);
        } else if (process.env.TOR_ENABLED === "true") {
          log("[Tor] Hidden service başlatılamadı — normal HTTP modunda devam ediliyor.");
        }
      }
    });

    // Temiz kapatma
    process.on("SIGINT", () => { stopTor(); process.exit(0); });
    process.on("SIGTERM", () => { stopTor(); process.exit(0); });
  }
})();
