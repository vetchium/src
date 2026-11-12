namespace Vetchium;

/** An Opening tag catalog OID such as `golang` or `artificial-intelligence`. */
@minLength(2)
@maxLength(64)
@pattern("^[a-z0-9]+(-[a-z0-9]+)*$")
scalar OpeningTagOID extends string;

model OpeningTag {
  tag_oid: OpeningTagOID;

  /** The English default name. */
  display_name: string;

  /** Maps a base language subtag to a name; `{}` when none. */
  localized_names: Record<string>;

  deprecated: boolean;
}

/** The whole catalog ordered by OID, at most 500, deprecated tags included. */
model ListOpeningTagsResponse {
  tags: OpeningTag[];
}
