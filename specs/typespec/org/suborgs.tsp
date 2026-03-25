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
  suborg_id: string;
  name: string;
  pinned_region: string;
  status: string;
  created_at: string;
}

model ListSubOrgsRequest {
  filter_status?: string;
  pagination_key?: string;
}

model ListSubOrgsResponse {
  sub_orgs: SubOrg[];
  next_pagination_key?: string;
}

model RenameSubOrgRequest {
  suborg_id: string;
  name: string;
}

model UpdateSubOrgStatusRequest {
  suborg_id: string;
}

model AddSubOrgMemberRequest {
  suborg_id: string;
  org_user_id: string;
}

model RemoveSubOrgMemberRequest {
  suborg_id: string;
  org_user_id: string;
}

model SubOrgMember {
  org_user_id: string;
  full_name?: string;
  email_address: string;
  assigned_at: string;
}

model ListSubOrgMembersRequest {
  suborg_id: string;
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
