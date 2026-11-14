import { Flex, Select } from "antd";
import type { ReactNode } from "react";
import { maxOpeningTags } from "typespec/common/opening_tags";
import { OpeningTagIcon } from "./icons.tsx";
import {
  compareOpeningTagNames,
  type OpeningTagCatalog,
  openingTagMatches,
  openingTagName,
} from "./names.ts";

export interface OpeningTagSelectProps {
  value?: string[];
  onChange?: (value: string[]) => void;
  /** The portal locale, which picks tag names (OPN-TAG-004). */
  locale: string;
  catalog: OpeningTagCatalog;
  placeholder?: string;
  notFoundContent?: ReactNode;
  id?: string;
  "aria-label"?: string;
  disabled?: boolean;
}

interface TagOption {
  value: string;
  label: ReactNode;
  title: string;
  oid: string;
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
  id,
  "aria-label": ariaLabel,
  disabled,
}: OpeningTagSelectProps) {
  const selected = value ?? [];
  const option = (oid: string): TagOption => {
    const name = openingTagName(catalog, oid, locale);
    return {
      value: oid,
      oid,
      title: name,
      label: (
        <Flex gap="small" align="center">
          <OpeningTagIcon oid={oid} />
          {name}
        </Flex>
      ),
    };
  };
  const offered = [...catalog.values()]
    .filter((tag) => !tag.deprecated || selected.includes(tag.tag_oid))
    .sort((a, b) => compareOpeningTagNames(catalog, a, b, locale))
    .map((tag) => option(tag.tag_oid));
  const unknown = selected
    .filter((oid) => !catalog.has(oid))
    .map((oid) => option(oid));
  return (
    <Select<string[], TagOption>
      id={id}
      aria-label={ariaLabel}
      mode="multiple"
      maxCount={maxOpeningTags}
      value={selected}
      onChange={(next) => onChange?.(next)}
      options={[...offered, ...unknown]}
      placeholder={placeholder}
      notFoundContent={notFoundContent}
      disabled={disabled}
      showSearch={{
        filterOption: (input, candidate) => {
          if (candidate === undefined) return false;
          const tag = catalog.get(candidate.oid);
          return tag === undefined
            ? candidate.oid.includes(input.trim().toLowerCase())
            : openingTagMatches(tag, input, locale);
        },
      }}
    />
  );
}
