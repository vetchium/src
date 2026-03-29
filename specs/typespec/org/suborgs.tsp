import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

model CreateSubOrgRequest {
  name: string;
  pinned_region: string;
}

model SubOrg {
  name: string;
  pinned_region: string;
  status: string;
  created_at: string;
}

model ListSubOrgsRequest {
  filter_status?: string;
  pagination_key?: string;
  limit?: int32;
}

model ListSubOrgsResponse {
  sub_orgs: SubOrg[];
  next_pagination_key?: string;
}

model RenameSubOrgRequest {
  name: string;
  new_name: string;
}

model UpdateSubOrgStatusRequest {
  name: string;
}

model AddSubOrgMemberRequest {
  name: string;
  email_address: string;
}

model RemoveSubOrgMemberRequest {
  name: string;
  email_address: string;
}

model SubOrgMember {
  full_name?: string;
  email_address: string;
  assigned_at: string;
}

model ListSubOrgMembersRequest {
  name: string;
  pagination_key?: string;
}

model ListSubOrgMembersResponse {
  members: SubOrgMember[];
  next_pagination_key?: string;
}

@route("/org")
interface OrgSubOrgs {
  @route("/create-suborg") @post createSubOrg(@body body: CreateSubOrgRequest): SubOrg | BadRequestResponse;
  @route("/list-suborgs") @post listSubOrgs(@body body: ListSubOrgsRequest): ListSubOrgsResponse | BadRequestResponse;
  @route("/rename-suborg") @post renameSubOrg(@body body: RenameSubOrgRequest): SubOrg | BadRequestResponse;
  @route("/disable-suborg") @post disableSubOrg(@body body: UpdateSubOrgStatusRequest): SubOrg | BadRequestResponse;
  @route("/enable-suborg") @post enableSubOrg(@body body: UpdateSubOrgStatusRequest): SubOrg | BadRequestResponse;
  @route("/add-suborg-member") @post addSubOrgMember(@body body: AddSubOrgMemberRequest): NoContentResponse | BadRequestResponse;
  @route("/remove-suborg-member") @post removeSubOrgMember(@body body: RemoveSubOrgMemberRequest): NoContentResponse | BadRequestResponse;
  @route("/list-suborg-members") @post listSubOrgMembers(@body body: ListSubOrgMembersRequest): ListSubOrgMembersResponse | BadRequestResponse;
}
