import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// ============================================
// SubOrgs
// ============================================

model SubOrg {
  @doc("UUID of the SubOrg")
  id: string;

  @doc("Display name shown to job seekers (e.g. 'Acme Corp LLC')")
  name: string;

  @doc("Vetchium region this SubOrg is pinned to (e.g. 'ind1', 'usa1', 'deu1')")
  pinned_region: string;

  @doc("Status of the SubOrg: 'active' or 'disabled'")
  status: string;

  @doc("Timestamp when the SubOrg was created (RFC3339)")
  created_at: string;
}

model SubOrgMember {
  @doc("Email address of the org user")
  email_address: string;

  @doc("Display name of the org user")
  name: string;

  @doc("Timestamp when the user was assigned to this SubOrg (RFC3339)")
  assigned_at: string;
}

model CreateSubOrgRequest {
  @doc("Display name for the SubOrg (1-64 chars)")
  name: string;

  @doc("Vetchium region to pin this SubOrg to (e.g. 'ind1', 'usa1', 'deu1')")
  pinned_region: string;
}

model ListSubOrgsRequest {
  @doc("Optional status filter: 'active' or 'disabled'; omit to return all")
  filter_status?: string;

  @doc("Optional cursor for keyset pagination")
  cursor?: string;

  @doc("Maximum number of results to return (default 40, max 100)")
  limit?: int32;
}

model ListSubOrgsResponse {
  @doc("List of SubOrgs for the current page")
  suborgs: SubOrg[];

  @doc("Cursor for the next page (empty string if no more results)")
  next_cursor: string;
}

model RenameSubOrgRequest {
  @doc("UUID of the SubOrg to rename")
  suborg_id: string;

  @doc("New display name (1-64 chars)")
  name: string;
}

model DisableSubOrgRequest {
  @doc("UUID of the SubOrg to disable")
  suborg_id: string;
}

model EnableSubOrgRequest {
  @doc("UUID of the SubOrg to re-enable")
  suborg_id: string;
}

model AddSubOrgMemberRequest {
  @doc("UUID of the SubOrg")
  suborg_id: string;

  @doc("Email address of the org user to assign")
  email_address: string;
}

model RemoveSubOrgMemberRequest {
  @doc("UUID of the SubOrg")
  suborg_id: string;

  @doc("Email address of the org user to remove")
  email_address: string;
}

model ListSubOrgMembersRequest {
  @doc("UUID of the SubOrg whose members to list")
  suborg_id: string;

  @doc("Optional cursor for keyset pagination")
  cursor?: string;

  @doc("Maximum number of results to return (default 40, max 100)")
  limit?: int32;
}

model ListSubOrgMembersResponse {
  @doc("List of members for the current page")
  members: SubOrgMember[];

  @doc("Cursor for the next page (empty string if no more results)")
  next_cursor: string;
}

@route("/employer/create-suborg")
@post
op createSubOrg(@body request: CreateSubOrgRequest): {
  @statusCode statusCode: 201;
  @body suborg: SubOrg;
} | {
  @statusCode statusCode: 400;
} | {
  @statusCode statusCode: 401;
} | {
  @statusCode statusCode: 403;
} | {
  @statusCode statusCode: 409;
};

@route("/employer/list-suborgs")
@post
op listSubOrgs(@body request: ListSubOrgsRequest): {
  @statusCode statusCode: 200;
  @body response: ListSubOrgsResponse;
} | {
  @statusCode statusCode: 400;
} | {
  @statusCode statusCode: 401;
};

@route("/employer/rename-suborg")
@post
op renameSubOrg(@body request: RenameSubOrgRequest): {
  @statusCode statusCode: 200;
  @body suborg: SubOrg;
} | {
  @statusCode statusCode: 400;
} | {
  @statusCode statusCode: 401;
} | {
  @statusCode statusCode: 403;
} | {
  @statusCode statusCode: 404;
};

@route("/employer/disable-suborg")
@post
op disableSubOrg(@body request: DisableSubOrgRequest): {
  @statusCode statusCode: 200;
} | {
  @statusCode statusCode: 400;
} | {
  @statusCode statusCode: 401;
} | {
  @statusCode statusCode: 403;
} | {
  @statusCode statusCode: 404;
} | {
  @statusCode statusCode: 422;
};

@route("/employer/enable-suborg")
@post
op enableSubOrg(@body request: EnableSubOrgRequest): {
  @statusCode statusCode: 200;
} | {
  @statusCode statusCode: 400;
} | {
  @statusCode statusCode: 401;
} | {
  @statusCode statusCode: 403;
} | {
  @statusCode statusCode: 404;
} | {
  @statusCode statusCode: 422;
};

@route("/employer/add-suborg-member")
@post
op addSubOrgMember(@body request: AddSubOrgMemberRequest): {
  @statusCode statusCode: 200;
} | {
  @statusCode statusCode: 400;
} | {
  @statusCode statusCode: 401;
} | {
  @statusCode statusCode: 403;
} | {
  @statusCode statusCode: 404;
} | {
  @statusCode statusCode: 409;
};

@route("/employer/remove-suborg-member")
@post
op removeSubOrgMember(@body request: RemoveSubOrgMemberRequest): {
  @statusCode statusCode: 200;
} | {
  @statusCode statusCode: 400;
} | {
  @statusCode statusCode: 401;
} | {
  @statusCode statusCode: 403;
} | {
  @statusCode statusCode: 404;
};

@route("/employer/list-suborg-members")
@post
op listSubOrgMembers(@body request: ListSubOrgMembersRequest): {
  @statusCode statusCode: 200;
  @body response: ListSubOrgMembersResponse;
} | {
  @statusCode statusCode: 400;
} | {
  @statusCode statusCode: 401;
} | {
  @statusCode statusCode: 403;
} | {
  @statusCode statusCode: 404;
};
