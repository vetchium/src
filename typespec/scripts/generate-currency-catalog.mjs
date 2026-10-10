import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Intl.supportedValuesOf("currency") supplies the runtime CLDR's active ISO 4217 codes.
const output = `${JSON.stringify(Intl.supportedValuesOf("currency").sort(), null, 2)}\n`;
const path = fileURLToPath(
  new URL("../common/currency_catalog.json", import.meta.url),
);

if (process.argv.includes("--check")) {
  if ((await readFile(path, "utf8")) !== output) {
    throw new Error(
      "currency catalog is stale; run npm run generate:currency-catalog",
    );
  }
} else {
  await writeFile(path, output);
}
