import {
	type ValidationError,
	newValidationError,
	ERR_REQUIRED,
} from "../common/common";

export type SubOrgStatus = "active" | "disabled";

export const VALID_SUBORG_REGIONS = ["ind1", "usa1", "deu1", "sgp1"] as const;
export type SubOrgRegion = (typeof VALID_SUBORG_REGIONS)[number];

export interface SubOrg {
	id: string;
	name: string;
	pinned_region: string;
	status: SubOrgStatus;
	created_at: string;
}

export interface SubOrgMember {
	email_address: string;
	name: string;
	assigned_at: string;
}

export interface CreateSubOrgRequest {
	name: string;
	pinned_region: string;
}

export interface ListSubOrgsRequest {
	filter_status?: SubOrgStatus;
	cursor?: string;
	limit?: number;
}

export interface ListSubOrgsResponse {
	suborgs: SubOrg[];
	next_cursor: string;
}

export interface RenameSubOrgRequest {
	suborg_id: string;
	name: string;
}

export interface DisableSubOrgRequest {
	suborg_id: string;
}

export interface EnableSubOrgRequest {
	suborg_id: string;
}

export interface AddSubOrgMemberRequest {
	suborg_id: string;
	email_address: string;
}

export interface RemoveSubOrgMemberRequest {
	suborg_id: string;
	email_address: string;
}

export interface ListSubOrgMembersRequest {
	suborg_id: string;
	cursor?: string;
	limit?: number;
}

export interface ListSubOrgMembersResponse {
	members: SubOrgMember[];
	next_cursor: string;
}

const ERR_NAME_TOO_LONG = "name must be at most 64 characters";
const ERR_REGION_INVALID =
	"pinned_region must be one of: ind1, usa1, deu1, sgp1";
const ERR_FILTER_STATUS_INVALID =
	"filter_status must be 'active' or 'disabled'";

export function validateCreateSubOrgRequest(
	request: CreateSubOrgRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.name) {
		errs.push(newValidationError("name", ERR_REQUIRED));
	} else if (request.name.length > 64) {
		errs.push(newValidationError("name", ERR_NAME_TOO_LONG));
	}

	if (!request.pinned_region) {
		errs.push(newValidationError("pinned_region", ERR_REQUIRED));
	} else if (
		!VALID_SUBORG_REGIONS.includes(request.pinned_region as SubOrgRegion)
	) {
		errs.push(newValidationError("pinned_region", ERR_REGION_INVALID));
	}

	return errs;
}

export function validateListSubOrgsRequest(
	request: ListSubOrgsRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (
		request.filter_status &&
		request.filter_status !== "active" &&
		request.filter_status !== "disabled"
	) {
		errs.push(newValidationError("filter_status", ERR_FILTER_STATUS_INVALID));
	}

	return errs;
}

export function validateRenameSubOrgRequest(
	request: RenameSubOrgRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.suborg_id) {
		errs.push(newValidationError("suborg_id", ERR_REQUIRED));
	}

	if (!request.name) {
		errs.push(newValidationError("name", ERR_REQUIRED));
	} else if (request.name.length > 64) {
		errs.push(newValidationError("name", ERR_NAME_TOO_LONG));
	}

	return errs;
}

export function validateDisableSubOrgRequest(
	request: DisableSubOrgRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!request.suborg_id) {
		errs.push(newValidationError("suborg_id", ERR_REQUIRED));
	}
	return errs;
}

export function validateEnableSubOrgRequest(
	request: EnableSubOrgRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!request.suborg_id) {
		errs.push(newValidationError("suborg_id", ERR_REQUIRED));
	}
	return errs;
}

export function validateAddSubOrgMemberRequest(
	request: AddSubOrgMemberRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!request.suborg_id) {
		errs.push(newValidationError("suborg_id", ERR_REQUIRED));
	}
	if (!request.email_address) {
		errs.push(newValidationError("email_address", ERR_REQUIRED));
	}
	return errs;
}

export function validateRemoveSubOrgMemberRequest(
	request: RemoveSubOrgMemberRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!request.suborg_id) {
		errs.push(newValidationError("suborg_id", ERR_REQUIRED));
	}
	if (!request.email_address) {
		errs.push(newValidationError("email_address", ERR_REQUIRED));
	}
	return errs;
}

export function validateListSubOrgMembersRequest(
	request: ListSubOrgMembersRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!request.suborg_id) {
		errs.push(newValidationError("suborg_id", ERR_REQUIRED));
	}
	return errs;
}
