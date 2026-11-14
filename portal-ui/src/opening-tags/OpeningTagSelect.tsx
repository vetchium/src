import { Select } from "antd";
import type { ReactNode } from "react";
import { maxOpeningTags } from "typespec/common/opening_tags";
import { type OpeningTagCatalog, sortedOpeningTags } from "./names.ts";
import {
  type OpeningTagOption,
  openingTagOption,
  openingTagSearch,
  openingTagsUnavailable,
} from "./options.tsx";

export interface OpeningTagSelectProps {
  value?: string[];
  onChange?: (value: string[]) => void;
  /** The portal locale, which picks tag names (OPN-TAG-004). */
  locale: string;
  catalog: OpeningTagCatalog;
  placeholder?: string;
  notFoundContent?: ReactNode;
  /** Set when the catalog could not be read; shown above any options. */
  unavailable?: string;
  id?: string;
  "aria-label"?: string;
  disabled?: boolean;
}

/**
 * A searchable pick of at most five tags. A deprecated tag is offered only
 * while the value already holds it (OPN-TAG-008).
 */
export function OpeningTagSelect({
  value,
  onChange,
  locale,
  catalog,
  placeholder,
  notFoundContent,
  unavailable,
  id,
  "aria-label": ariaLabel,
  disabled,
}: OpeningTagSelectProps) {
  const selected = value ?? [];
  const offered = sortedOpeningTags(
    catalog,
    locale,
    (tag) => !tag.deprecated || selected.includes(tag.tag_oid),
  ).map((tag) => openingTagOption(catalog, tag.tag_oid, locale));
  const unknown = selected
    .filter((oid) => !catalog.has(oid))
    .map((oid) => openingTagOption(catalog, oid, locale));
  return (
    <Select<string[], OpeningTagOption>
      id={id}
      aria-label={ariaLabel}
      mode="multiple"
      maxCount={maxOpeningTags}
      value={selected}
      onChange={(next) => onChange?.(next)}
      options={[...offered, ...unknown]}
      placeholder={unavailable ?? placeholder}
      notFoundContent={notFoundContent}
      disabled={disabled}
      showSearch={openingTagSearch(catalog, locale)}
      {...openingTagsUnavailable(unavailable)}
    />
  );
}
