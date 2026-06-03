import { createWriteStream, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const [jsonPath, outputPath] = process.argv.slice(2);

if (!jsonPath || !outputPath) {
  console.error("Usage: node scripts/ci/download-eas-artifact.mjs <eas-json> <output>");
  process.exit(1);
}

function parseJsonWithPossibleNoise(raw) {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}

  const firstArray = trimmed.indexOf("[");
  const firstObject = trimmed.indexOf("{");
  const starts = [firstArray, firstObject].filter((index) => index >= 0);
  if (starts.length === 0) throw new Error("No JSON object found in EAS output");

  return JSON.parse(trimmed.slice(Math.min(...starts)));
}

function findArtifactUrl(value) {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findArtifactUrl(item);
      if (found) return found;
    }
    return "";
  }

  const direct =
    value.artifactUrl ||
    value.buildUrl ||
    value.artifacts?.buildUrl ||
    value.artifacts?.applicationArchiveUrl ||
    "";
  if (typeof direct === "string" && /^https?:\/\//.test(direct)) {
    return direct;
  }

  for (const item of Object.values(value)) {
    const found = findArtifactUrl(item);
    if (found) return found;
  }
  return "";
}

const parsed = parseJsonWithPossibleNoise(readFileSync(jsonPath, "utf8"));
const artifactUrl = findArtifactUrl(parsed);

if (!artifactUrl) {
  console.error("Could not find a downloadable artifact URL in EAS output.");
  process.exit(1);
}

const response = await fetch(artifactUrl);
if (!response.ok || !response.body) {
  console.error(`Failed to download artifact: ${response.status} ${response.statusText}`);
  process.exit(1);
}

await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));
console.log(`Downloaded ${artifactUrl} -> ${outputPath}`);
