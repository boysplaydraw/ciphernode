import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const serverUrl = process.env.API_URL || process.env.EXPO_PUBLIC_SERVER_URL;
const outputDir = process.env.HOSTINGER_OUTPUT_DIR || "hostinger-web";

if (!serverUrl) {
  console.error(
    "API_URL or EXPO_PUBLIC_SERVER_URL is required. Example: API_URL=https://relay.example.com npm run web:hostinger",
  );
  process.exit(1);
}

const normalizedServerUrl = serverUrl.replace(/\/$/, "");
const normalizedServerUrlWithSlash = `${normalizedServerUrl}/`;
const defaultWsUrl = new URL("/ws", normalizedServerUrlWithSlash);
defaultWsUrl.protocol = defaultWsUrl.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = process.env.WS_URL || process.env.EXPO_PUBLIC_WS_URL || defaultWsUrl.toString();

process.env.EXPO_PUBLIC_SERVER_URL = serverUrl;
process.env.EXPO_PUBLIC_WS_URL = wsUrl;

process.env.EXPO_PUBLIC_RELAY_TRANSPORT =
  process.env.EXPO_PUBLIC_RELAY_TRANSPORT || "websocket";

const result = spawnSync(
  "npx",
  ["expo", "export", "--platform", "web", "--output-dir", outputDir],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  },
);

if (result.status !== 0) {
  if (result.error) {
    console.error(result.error.message);
  }
  process.exit(result.status ?? 1);
}

// Verify the server URL was baked in by Expo (via EXPO_PUBLIC_SERVER_URL env var).
// If found, no further patching is needed. If missing, apply legacy regex patches as fallback.
const webJsDir = join(outputDir, "_expo", "static", "js", "web");
let urlFoundInBundle = false;
let patchedServerBundle = false;

for (const file of readdirSync(webJsDir)) {
  if (!file.endsWith(".js")) continue;

  const path = join(webJsDir, file);
  let contents = readFileSync(path, "utf8");

  if (contents.includes(normalizedServerUrl)) {
    urlFoundInBundle = true;
    continue;
  }

  const original = contents;

  contents = contents.replace(
    /getOfficialServerUrl=function\(\)\{return null\}/g,
    `getOfficialServerUrl=function(){return "${normalizedServerUrl}"}`,
  );
  contents = contents.replace(
    /function l\(\)\{return s&&s\.trim\(\)\?s\.trim\(\)\.replace\(\/\\\/\$\/,""\)\+"\/":"undefined"!=typeof window&&window\.location\?\.origin\?window\.location\.origin\+"\/":"http:\/\/localhost:5000\/"\}/g,
    `function l(){return s&&s.trim()?s.trim().replace(/\\/$/,"")+"/":"${normalizedServerUrlWithSlash}"}`,
  );

  if (contents !== original) {
    writeFileSync(path, contents);
    patchedServerBundle = true;
  }
}

if (!urlFoundInBundle && !patchedServerBundle) {
  console.error("Could not inject EXPO_PUBLIC_SERVER_URL into the Hostinger JS bundle.");
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(
  join(outputDir, ".htaccess"),
  `Options -Indexes
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
`,
);

console.log(`Hostinger static build ready: ${outputDir}`);
