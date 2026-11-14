/** An Opening tag catalog OID such as `golang` or `artificial-intelligence`. */
export type OpeningTagOID = string;

export const maxOpeningTags = 5;

const openingTagOIDPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isOpeningTagOID(value: string): value is OpeningTagOID {
  return (
    value.length >= 2 && value.length <= 64 && openingTagOIDPattern.test(value)
  );
}

export interface OpeningTag {
  tag_oid: OpeningTagOID;
  /** The English default name. */
  display_name: string;
  /** Maps a base language subtag to a name; `{}` when none. */
  localized_names: Record<string, string>;
  deprecated: boolean;
}

export type ListOpeningTagsRequest = Record<string, never>;

/** The whole catalog ordered by OID, at most 500, deprecated tags included. */
export interface ListOpeningTagsResponse {
  tags: OpeningTag[];
}
