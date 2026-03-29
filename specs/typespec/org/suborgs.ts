import { type ValidationError, newValidationError } from "../common/common";

const SUBORG_NAME_MAX_LENGTH = 64;

export const ERR_SUBORG_NAME_REQUIRED = "name is required";
export const ERR_SUBORG_NAME_TOO_LONG = "name must be at most 64 characters";
export const ERR_SUBORG_NEW_NAME_REQUIRED = "new_name is required";
export const ERR_SUBORG_NEW_NAME_TOO_LONG =
	"new_name must be at most 64 characters";
export const ERR_SUBORG_REGION_REQUIRED = "pinned_region is required";
export const ERR_SUBORG_EMAIL_REQUIRED = "email_address is required";

// SubOrg is the response type for SubOrg reads.
export interface SubOrg {
	name: string;
	pinned_region: string;
	status: string;
	created_at: string;
}

// SubOrgMember is a member of a SubOrg.
export interface SubOrgMember {
	email_address: string;
	full_name?: string;
	assigned_at: string;
}

// CreateSubOrgRequest is the request body for POST /org/create-suborg.
export interface CreateSubOrgRequest {
	name: string;
	pinned_region: string;
}

export function validateCreateSubOrgRequest(
	request: CreateSubOrgRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.name) {
		errs.push(newValidationError("name", ERR_SUBORG_NAME_REQUIRED));
	} else if (request.name.length > SUBORG_NAME_MAX_LENGTH) {
		errs.push(newValidationError("name", ERR_SUBORG_NAME_TOO_LONG));
	}

	if (!request.pinned_region) {
		errs.push(newValidationError("pinned_region", ERR_SUBORG_REGION_REQUIRED));
	}

	return errs;
}

// ListSubOrgsRequest is the request body for POST /org/list-suborgs.
export interface ListSubOrgsRequest {
	filter_status?: string;
	pagination_key?: string;
	limit?: number;
}

export function validateListSubOrgsRequest(
	request: ListSubOrgsRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (
		request.filter_status !== undefined &&
		request.filter_status !== "active" &&
		request.filter_status !== "disabled"
	) {
		errs.push(
			newValidationError(
				"filter_status",
				"filter_status must be 'active' or 'disabled'"
			)
		);
	}

	return errs;
}

// ListSubOrgsResponse is the response for POST /org/list-suborgs.
export interface ListSubOrgsResponse {
	suborgs: SubOrg[];
	next_pagination_key: string;
}

// RenameSubOrgRequest is the request body for POST /org/rename-suborg.
export interface RenameSubOrgRequest {
	name: string;
	new_name: string;
}

export function validateRenameSubOrgRequest(
	request: RenameSubOrgRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.name) {
		errs.push(newValidationError("name", ERR_SUBORG_NAME_REQUIRED));
	} else if (request.name.length > SUBORG_NAME_MAX_LENGTH) {
		errs.push(newValidationError("name", ERR_SUBORG_NAME_TOO_LONG));
	}

	if (!request.new_name) {
		errs.push(newValidationError("new_name", ERR_SUBORG_NEW_NAME_REQUIRED));
	} else if (request.new_name.length > SUBORG_NAME_MAX_LENGTH) {
		errs.push(newValidationError("new_name", ERR_SUBORG_NEW_NAME_TOO_LONG));
	}

	return errs;
}

// DisableSubOrgRequest is the request body for POST /org/disable-suborg.
export interface DisableSubOrgRequest {
	name: string;
}

export function validateDisableSubOrgRequest(
	request: DisableSubOrgRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.name) {
		errs.push(newValidationError("name", ERR_SUBORG_NAME_REQUIRED));
	}

	return errs;
}

// EnableSubOrgRequest is the request body for POST /org/enable-suborg.
export interface EnableSubOrgRequest {
	name: string;
}

export function validateEnableSubOrgRequest(
	request: EnableSubOrgRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.name) {
		errs.push(newValidationError("name", ERR_SUBORG_NAME_REQUIRED));
	}

	return errs;
}

// AddSubOrgMemberRequest is the request body for POST /org/add-suborg-member.
export interface AddSubOrgMemberRequest {
	name: string;
	email_address: string;
}

export function validateAddSubOrgMemberRequest(
	request: AddSubOrgMemberRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.name) {
		errs.push(newValidationError("name", ERR_SUBORG_NAME_REQUIRED));
	}

	if (!request.email_address) {
		errs.push(newValidationError("email_address", ERR_SUBORG_EMAIL_REQUIRED));
	}

	return errs;
}

// RemoveSubOrgMemberRequest is the request body for POST /org/remove-suborg-member.
export interface RemoveSubOrgMemberRequest {
	name: string;
	email_address: string;
}

export function validateRemoveSubOrgMemberRequest(
	request: RemoveSubOrgMemberRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.name) {
		errs.push(newValidationError("name", ERR_SUBORG_NAME_REQUIRED));
	}

	if (!request.email_address) {
		errs.push(newValidationError("email_address", ERR_SUBORG_EMAIL_REQUIRED));
	}

	return errs;
}

// ListSubOrgMembersRequest is the request body for POST /org/list-suborg-members.
export interface ListSubOrgMembersRequest {
	name: string;
	pagination_key?: string;
}

export function validateListSubOrgMembersRequest(
	request: ListSubOrgMembersRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.name) {
		errs.push(newValidationError("name", ERR_SUBORG_NAME_REQUIRED));
	}

	return errs;
}

// ListSubOrgMembersResponse is the response for POST /org/list-suborg-members.
export interface ListSubOrgMembersResponse {
	members: SubOrgMember[];
	next_pagination_key: string;
}
