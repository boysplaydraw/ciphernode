import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const serverUrl = process.env.EXPO_PUBLIC_SERVER_URL;
const outputDir = process.env.HOSTINGER_OUTPUT_DIR || "hostinger-web";

if (!serverUrl) {
  console.error(
    "EXPO_PUBLIC_SERVER_URL is required. Example: EXPO_PUBLIC_SERVER_URL=https://relay.example.com npm run web:hostinger",
  );
  process.exit(1);
}

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
