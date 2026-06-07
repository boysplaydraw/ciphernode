/* eslint-env node */
/**
 * build-tauri-sidecar.mjs — Go relay backend'ini Tauri sidecar ikilisi olarak derler.
 *
 * Tauri externalBin, ikili dosyanın hedef üçlüsü (target triple) ile adlandırılmasını
 * ister: ör. `ciphernode-backend-x86_64-pc-windows-msvc.exe`. Bu script geçerli host
 * üçlüsünü `rustc -Vv` ile tespit eder ve Go binary'sini doğru isimle src-tauri/binaries
 * altına üretir.
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

function hostTriple() {
  const out = execSync("rustc -Vv").toString();
  const line = out.split("\n").find((l) => l.startsWith("host:"));
  if (!line) throw new Error("rustc host üçlüsü tespit edilemedi (rustc kurulu mu?)");
  return line.replace("host:", "").trim();
}

const triple = hostTriple();
const ext = process.platform === "win32" ? ".exe" : "";
const outDir = path.resolve("src-tauri", "binaries");
const outFile = path.join(outDir, `ciphernode-backend-${triple}${ext}`);

mkdirSync(outDir, { recursive: true });

console.log(`[sidecar] Go relay derleniyor -> ${outFile}`);
execSync(`go build -o "${outFile}" ./cmd/ciphernode-server`, {
  cwd: path.resolve("server", "go"),
  stdio: "inherit",
});
console.log("[sidecar] Tamamlandı.");
