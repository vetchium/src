import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// ============================================
// Agency Tags (read-only view of global tags)
// ============================================

@doc("A tag as seen by agency users, localised to a single locale.")
model AgencyTag {
  @doc("Unique tag identifier")
  tag_id: string;

  @doc("Display name in the requested locale (falls back to en-US)")
  display_name: string;

  @doc("Optional description in the requested locale")
  description?: string;

  @doc("Publicly accessible URL for the small icon, if uploaded")
  small_icon_url?: string;

  @doc("Publicly accessible URL for the large icon, if uploaded")
  large_icon_url?: string;
}

@doc("Request to retrieve a tag, optionally localised to a specific locale.")
model AgencyGetTagRequest {
  @doc("Identifier of the tag to retrieve")
  tag_id: string;

  @doc("BCP 47 locale code; defaults to en-US when omitted")
  locale?: string;
}

@doc("Request to filter/search tags with optional locale and pagination.")
model AgencyFilterTagsRequest {
  @doc("Optional full-text search string")
  query?: string;

  @doc("Keyset cursor for the next page")
  pagination_key?: string;

  @doc("BCP 47 locale code; defaults to en-US when omitted")
  locale?: string;
}

@doc("Response for the agency filter-tags endpoint.")
model AgencyFilterTagsResponse {
  @doc("Matching tags for the current page")
  tags: AgencyTag[];

  @doc("Keyset cursor for the next page; absent when no more results")
  pagination_key?: string;
}

// ============================================
// Agency Tag Endpoints
// ============================================

@route("/agency/get-tag")
interface AgencyGetTagOps {
  @doc("Retrieve a tag localised to the requested locale.")
  @post
  getTag(@body request: AgencyGetTagRequest): AgencyTag | {
    @statusCode statusCode: 400;
    @body errors: ValidationError[];
  } | {
    @statusCode statusCode: 401;
  } | {
    @statusCode statusCode: 404;
  };
}

@route("/agency/filter-tags")
interface AgencyFilterTagsOps {
  @doc("Filter/search tags with optional query, locale, and pagination.")
  @post
  filterTags(@body request: AgencyFilterTagsRequest): AgencyFilterTagsResponse | {
    @statusCode statusCode: 401;
  };
}
