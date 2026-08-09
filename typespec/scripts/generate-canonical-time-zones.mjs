import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "common/canonical-time-zones.txt");
const outputPath = resolve(root, "common/canonical-time-zones.generated.ts");
const zones = (await readFile(sourcePath, "utf8"))
  .split(/\r?\n/)
  .filter(Boolean);

if (
  zones.length === 0 ||
  zones.some((zone, index) => index > 0 && zone <= zones[index - 1])
) {
  throw new Error(
    "canonical timezone source must be non-empty, unique, and sorted",
  );
}

const output = [
  "// Generated from canonical-time-zones.txt; do not edit by hand.",
  "export const canonicalTimeZoneIDs = new Set<string>([",
  ...zones.map((zone) => `  ${JSON.stringify(zone)},`),
  "]);",
  "",
].join("\n");

if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== output) {
    throw new Error(
      "canonical timezone artifact is stale; run npm run generate:timezones",
    );
  }
} else {
  await writeFile(outputPath, output);
}
