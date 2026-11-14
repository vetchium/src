import { Alert, Flex } from "antd";
import type { ReactElement, ReactNode } from "react";
import { OpeningTagIcon } from "./icons.tsx";
import {
  type OpeningTagCatalog,
  openingTagName,
  openingTagOptionMatches,
} from "./names.ts";

export interface OpeningTagOption {
  value: string;
  title: string;
  label: ReactNode;
}

/** A tag as a Select option: its icon and its name in the portal language. */
export function openingTagOption(
  catalog: OpeningTagCatalog,
  oid: string,
  locale: string,
): OpeningTagOption {
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
}

/** Select search over a tag option's names and OID. */
export function openingTagSearch(catalog: OpeningTagCatalog, locale: string) {
  return {
    filterOption: (input: string, option?: OpeningTagOption) =>
      option !== undefined &&
      openingTagOptionMatches(catalog, option.value, input, locale),
  };
}

/**
 * Select props for a catalog that could not be read: an error status and a
 * message above the options, since a selected tag hides the placeholder.
 */
export function openingTagsUnavailable(unavailable: string | undefined) {
  if (unavailable === undefined) return {};
  return {
    status: "error" as const,
    notFoundContent: null,
    popupRender: (menu: ReactElement) => (
      <Flex vertical gap="small">
        <Alert type="error" showIcon title={unavailable} />
        {menu}
      </Flex>
    ),
  };
}
