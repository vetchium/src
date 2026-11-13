import { Flex, Select } from "antd";
import type { CSSProperties } from "react";
import { OpeningTagIcon } from "./icons.tsx";
import {
  compareOpeningTagNames,
  type OpeningTagCatalog,
  openingTagMatches,
  openingTagName,
} from "./names.ts";

export interface OpeningTagFilterProps {
  value?: string;
  onChange: (value: string | undefined) => void;
  /** The portal locale, which picks tag names (OPN-TAG-004). */
  locale: string;
  catalog: OpeningTagCatalog;
  /** The control's accessible name, such as "Tag". */
  label: string;
  placeholder?: string;
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
  style,
}: OpeningTagFilterProps) {
  const option = (oid: string) => {
    const name = openingTagName(catalog, oid, locale);
    return {
      value: oid,
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
    .filter((tag) => !tag.deprecated)
    .sort((a, b) => compareOpeningTagNames(catalog, a, b, locale));
  const options = offered.map((tag) => option(tag.tag_oid));
  if (value !== undefined && !offered.some((tag) => tag.tag_oid === value))
    options.push(option(value));
  return (
    <Select<string>
      aria-label={label}
      value={value}
      onChange={(next?: string) => onChange(next || undefined)}
      options={options}
      placeholder={placeholder}
      style={style}
      // Names are longer than a filter-sized field; never cut them off.
      popupMatchSelectWidth={false}
      allowClear
      showSearch={{
        filterOption: (input, candidate) => {
          const oid = candidate?.value;
          if (typeof oid !== "string") return false;
          const tag = catalog.get(oid);
          return tag === undefined
            ? oid.includes(input.trim().toLowerCase())
            : openingTagMatches(tag, input, locale);
        },
      }}
    />
  );
}
