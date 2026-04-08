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

function configureExpoAndLanding(app: express.Application) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html",
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
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
