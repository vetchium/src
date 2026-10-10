import tags from "./language_catalog.json" with { type: "json" };

export type LanguageTag = string;

export const languageCatalog: readonly LanguageTag[] = tags;
const languageCatalogSet = new Set<string>(languageCatalog);

export function isLanguageTag(value: LanguageTag): boolean {
  return languageCatalogSet.has(value);
}
