import type {
  ListOpeningTagsResponse,
  OpeningTag,
} from "typespec/common/opening_tags";

export type OpeningTagCatalog = ReadonlyMap<string, OpeningTag>;

export function openingTagCatalog(
  response: ListOpeningTagsResponse,
): OpeningTagCatalog {
  return new Map(response.tags.map((tag) => [tag.tag_oid, tag]));
}

const baseLanguages = new Map<string, string>();

// Pickers name every tag on each render, so each locale is parsed once.
function baseLanguage(locale: string): string {
  let language = baseLanguages.get(locale);
  if (language === undefined) {
    language = new Intl.Locale(locale).language;
    baseLanguages.set(locale, language);
  }
  return language;
}

function localizedName(tag: OpeningTag, locale: string): string | undefined {
  return tag.localized_names[baseLanguage(locale)];
}

/**
 * The tag's name in the portal language (OPN-TAG-004), never the Opening's
 * language; an OID the catalog lacks shows as itself.
 */
export function openingTagName(
  catalog: OpeningTagCatalog,
  oid: string,
  locale: string,
): string {
  const tag = catalog.get(oid);
  if (tag === undefined) return oid;
  return localizedName(tag, locale) ?? tag.display_name;
}

/** The catalog tags that pass include, by the name shown in the portal language. */
export function sortedOpeningTags(
  catalog: OpeningTagCatalog,
  locale: string,
  include: (tag: OpeningTag) => boolean,
): OpeningTag[] {
  const collator = new Intl.Collator(locale);
  return [...catalog.values()]
    .filter(include)
    .map((tag) => ({ tag, name: openingTagName(catalog, tag.tag_oid, locale) }))
    .sort((a, b) => collator.compare(a.name, b.name))
    .map(({ tag }) => tag);
}

/** Picker search over the default name, the portal-language name, and the OID. */
export function openingTagMatches(
  tag: OpeningTag,
  query: string,
  locale: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase(locale);
  if (needle === "") return true;
  return [tag.display_name, localizedName(tag, locale), tag.tag_oid].some(
    (name) => name?.toLocaleLowerCase(locale).includes(needle) === true,
  );
}

/** Picker search over an option's OID, which may be missing from the catalog. */
export function openingTagOptionMatches(
  catalog: OpeningTagCatalog,
  oid: string,
  query: string,
  locale: string,
): boolean {
  const tag = catalog.get(oid);
  return tag === undefined
    ? oid.includes(query.trim().toLowerCase())
    : openingTagMatches(tag, query, locale);
}
