import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import englishData from "cldr-localenames-full/main/en/languages.json" with {
  type: "json",
};
import { iso6393 } from "iso-639-3";

const names = englishData.main.en.localeDisplayNames.languages;
const tags = [
  ...new Set(
    iso6393
      .filter((language) => language.type === "living")
      .map((language) => language.iso6391 ?? language.iso6393)
      .filter((tag) => /^[a-z]{2,3}$/.test(tag) && names[tag]),
  ),
].sort();

// ISO 639-3 3.0.1 and CLDR 48.2.0 are pinned in package.json. This
// intersection supplies CLDR display names, includes living sign languages
// represented there, and excludes constructed/historical/extinct languages.
// It was checked against the IANA language-subtag registry on 2026-09-19:
// none of these tags had both Deprecated and Preferred-Value fields.
const output = `${JSON.stringify(tags, null, 2)}\n`;
const path = fileURLToPath(
  new URL("../hub/profile/language_catalog.json", import.meta.url),
);

if (process.argv.includes("--check")) {
  if ((await readFile(path, "utf8")) !== output) {
    throw new Error(
      "language catalog is stale; run npm run generate:language-catalog",
    );
  }
} else {
  await writeFile(path, output);
}
