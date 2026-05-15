import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// ============================================
// Admin Tags
// ============================================

@doc("A single translation of a tag into a locale.")
model TagTranslation {
  @doc("BCP 47 locale code, e.g. 'en-US'")
  locale: string;

  @doc("Human-readable display name (max 100 chars)")
  display_name: string;

  @doc("Optional longer description (max 500 chars)")
  description?: string;
}

@doc("Full tag record as managed by admins, including all translations and icon URLs.")
model AdminTag {
  @doc("Unique tag identifier: lowercase letters, digits, and hyphens; max 64 chars")
  tag_id: string;

  @doc("All translations for this tag")
  translations: TagTranslation[];

  @doc("Publicly accessible URL for the small icon, if uploaded")
  small_icon_url?: string;

  @doc("Publicly accessible URL for the large icon, if uploaded")
  large_icon_url?: string;

  @doc("ISO 8601 creation timestamp")
  created_at: string;

  @doc("ISO 8601 last-updated timestamp")
  updated_at: string;
}

@doc("Request to create a new tag with its translations. Requires admin:manage_tags role.")
model CreateTagRequest {
  @doc("Unique tag identifier: lowercase letters, digits, and hyphens; max 64 chars; must not start or end with a hyphen")
  tag_id: string;

  @doc("At least one translation is required; en-US translation is mandatory")
  translations: TagTranslation[];
}

@doc("Request to replace all translations for an existing tag. Requires admin:manage_tags role.")
model UpdateTagRequest {
  @doc("Identifier of the tag to update")
  tag_id: string;

  @doc("Complete set of translations to store; replaces all existing translations")
  translations: TagTranslation[];
}

@doc("Request to retrieve a tag with all its translations.")
model GetTagRequest {
  @doc("Identifier of the tag to retrieve")
  tag_id: string;
}

@doc("Request to filter/search tags with optional query string and keyset pagination.")
model AdminFilterTagsRequest {
  @doc("Optional full-text search string applied against tag translations")
  query?: string;

  @doc("Keyset cursor for the next page")
  pagination_key?: string;

  @doc("Number of items to return (default and max enforced server-side)")
  limit?: int32;
}

@doc("Response for the admin filter-tags endpoint.")
model AdminFilterTagsResponse {
  @doc("Matching tags for the current page")
  tags: AdminTag[];

  @doc("Keyset cursor for the next page; absent when no more results")
  next_pagination_key?: string;
}

@doc("Request to delete a tag's icon. Requires admin:manage_tags role.")
model DeleteTagIconRequest {
  @doc("Identifier of the tag")
  tag_id: string;

  @doc("Which icon to delete: 'small' or 'large'")
  icon_size: string;
}

// ============================================
// Admin Tag Endpoints
// ============================================

@route("/admin/create-tag")
interface AdminCreateTagOps {
  @doc("Create a new tag. Requires admin:manage_tags role.")
  @post
  addTag(@body request: CreateTagRequest): {
    @statusCode statusCode: 201;
    @body tag: AdminTag;
  } | {
    @statusCode statusCode: 400;
    @body errors: ValidationError[];
  } | {
    @statusCode statusCode: 401;
  } | {
    @statusCode statusCode: 403;
  } | {
    @statusCode statusCode: 409;
  };
}

@route("/admin/update-tag")
interface AdminUpdateTagOps {
  @doc("Replace all translations for an existing tag. Requires admin:manage_tags role.")
  @post
  updateTag(@body request: UpdateTagRequest): AdminTag | {
    @statusCode statusCode: 400;
    @body errors: ValidationError[];
  } | {
    @statusCode statusCode: 401;
  } | {
    @statusCode statusCode: 403;
  } | {
    @statusCode statusCode: 404;
  };
}

@route("/admin/get-tag")
interface AdminGetTagOps {
  @doc("Retrieve a tag with all its translations.")
  @post
  getTag(@body request: GetTagRequest): AdminTag | {
    @statusCode statusCode: 400;
    @body errors: ValidationError[];
  } | {
    @statusCode statusCode: 401;
  } | {
    @statusCode statusCode: 404;
  };
}

@route("/admin/list-tags")
interface AdminListTagsOps {
  @doc("Filter/search tags with optional query and pagination.")
  @post
  filterTags(@body request: AdminFilterTagsRequest): AdminFilterTagsResponse | {
    @statusCode statusCode: 401;
  };
}

@route("/admin/upload-tag-icon")
interface AdminUploadTagIconOps {
  @doc("Upload a small or large icon for a tag (multipart/form-data). Requires admin:manage_tags role.")
  @post
  uploadTagIcon(): {
    @statusCode statusCode: 200;
  } | {
    @statusCode statusCode: 400;
    @body errors: ValidationError[];
  } | {
    @statusCode statusCode: 401;
  } | {
    @statusCode statusCode: 403;
  } | {
    @statusCode statusCode: 404;
  };
}

@route("/admin/delete-tag-icon")
interface AdminDeleteTagIconOps {
  @doc("Delete a tag's small or large icon. Requires admin:manage_tags role.")
  @post
  deleteTagIcon(@body request: DeleteTagIconRequest): {
    @statusCode statusCode: 200;
  } | {
    @statusCode statusCode: 400;
    @body errors: ValidationError[];
  } | {
    @statusCode statusCode: 401;
  } | {
    @statusCode statusCode: 403;
  } | {
    @statusCode statusCode: 404;
  };
}
