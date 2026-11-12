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

function localizedName(tag: OpeningTag, locale: string): string | undefined {
  return tag.localized_names[new Intl.Locale(locale).language];
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
