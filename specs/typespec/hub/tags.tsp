import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// ============================================
// Hub Tags (read-only view of global tags)
// ============================================

@doc("A tag as seen by hub users, localised to a single locale.")
model HubTag {
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
model HubGetTagRequest {
  @doc("Identifier of the tag to retrieve")
  tag_id: string;

  @doc("BCP 47 locale code; defaults to en-US when omitted")
  locale?: string;
}

@doc("Request to filter/search tags with optional locale and pagination.")
model HubFilterTagsRequest {
  @doc("Optional full-text search string")
  query?: string;

  @doc("Keyset cursor for the next page")
  pagination_key?: string;

  @doc("BCP 47 locale code; defaults to en-US when omitted")
  locale?: string;
}

@doc("Response for the hub filter-tags endpoint.")
model HubFilterTagsResponse {
  @doc("Matching tags for the current page")
  tags: HubTag[];

  @doc("Keyset cursor for the next page; absent when no more results")
  pagination_key?: string;
}

// ============================================
// Hub Tag Endpoints
// ============================================

@route("/hub/get-tag")
interface HubGetTagOps {
  @doc("Retrieve a tag localised to the requested locale.")
  @post
  getTag(@body request: HubGetTagRequest): HubTag | {
    @statusCode statusCode: 400;
    @body errors: ValidationError[];
  } | {
    @statusCode statusCode: 401;
  } | {
    @statusCode statusCode: 404;
  };
}

@route("/hub/filter-tags")
interface HubFilterTagsOps {
  @doc("Filter/search tags with optional query, locale, and pagination.")
  @post
  filterTags(@body request: HubFilterTagsRequest): HubFilterTagsResponse | {
    @statusCode statusCode: 401;
  };
}
