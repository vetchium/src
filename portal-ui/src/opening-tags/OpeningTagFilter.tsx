import { Select } from "antd";
import type { CSSProperties } from "react";
import { type OpeningTagCatalog, sortedOpeningTags } from "./names.ts";
import {
  type OpeningTagOption,
  openingTagOption,
  openingTagSearch,
  openingTagsUnavailable,
} from "./options.tsx";

export interface OpeningTagFilterProps {
  value?: string;
  onChange: (value: string | undefined) => void;
  /** The portal locale, which picks tag names (OPN-TAG-004). */
  locale: string;
  catalog: OpeningTagCatalog;
  /** The control's accessible name, such as "Tag". */
  label: string;
  placeholder?: string;
  /** Set when the catalog could not be read; shown above any options. */
  unavailable?: string;
  style?: CSSProperties;
}

/**
 * One tag to filter a list by. Deprecated tags are not offered; a value the
 * catalog no longer offers still shows, so the active filter stays visible.
 */
export function OpeningTagFilter({
  value,
  onChange,
  locale,
  catalog,
  label,
  placeholder,
  unavailable,
  style,
}: OpeningTagFilterProps) {
  const offered = sortedOpeningTags(catalog, locale, (tag) => !tag.deprecated);
  const options = offered.map((tag) =>
    openingTagOption(catalog, tag.tag_oid, locale),
  );
  if (value !== undefined && !offered.some((tag) => tag.tag_oid === value))
    options.push(openingTagOption(catalog, value, locale));
  return (
    <Select<string, OpeningTagOption>
      aria-label={label}
      value={value}
      onChange={(next?: string) => onChange(next || undefined)}
      options={options}
      placeholder={unavailable ?? placeholder}
      style={style}
      // Names are longer than a filter-sized field; never cut them off.
      popupMatchSelectWidth={false}
      allowClear
      showSearch={openingTagSearch(catalog, locale)}
      {...openingTagsUnavailable(unavailable)}
    />
  );
}
