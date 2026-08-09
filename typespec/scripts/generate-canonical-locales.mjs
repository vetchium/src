import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = [
  {
    name: "language",
    path: resolve(root, "common/canonical-language-subtags.txt"),
    pattern: /^[a-z]{2}$/,
  },
  {
    name: "region",
    path: resolve(root, "common/canonical-region-subtags.txt"),
    pattern: /^[A-Z]{2}$/,
  },
];

const values = {};
for (const source of sources) {
  const entries = (await readFile(source.path, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean);
  if (
    entries.length === 0 ||
    entries.some(
      (entry, index) =>
        !source.pattern.test(entry) ||
        (index > 0 && entry <= entries[index - 1]),
    )
  ) {
    throw new Error(
      `canonical ${source.name} source must be non-empty, valid, unique, and sorted`,
    );
  }
  values[source.name] = entries;
}

const outputPath = resolve(root, "common/canonical-locales.generated.ts");
const set = (name, entries) =>
  [
    `export const ${name} = new Set<string>([`,
    ...entries.map((entry) => `  ${JSON.stringify(entry)},`),
    "]);",
  ].join("\n");
const output = [
  "// Generated from the IANA-derived canonical subtag files; do not edit.",
  set("canonicalLanguageSubtags", values.language),
  set("canonicalRegionSubtags", values.region),
  "",
].join("\n");

if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== output) {
    throw new Error(
      "canonical locale artifact is stale; run npm run generate:locales",
    );
  }
} else {
  await writeFile(outputPath, output);
}
