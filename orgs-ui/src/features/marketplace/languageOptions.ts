import { languageCatalog } from "typespec/common/language_catalog";

export function languageOptions(locale: string) {
  const names = new Intl.DisplayNames([locale], { type: "language" });
  return languageCatalog.map((tag) => {
    let label = tag;
    try {
      label = names.of(tag) ?? tag;
    } catch {
      // Fallback to tag if unknown.
    }
    return {
      value: tag,
      label,
    };
  });
}
