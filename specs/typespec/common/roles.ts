import { newValidationError, type ValidationError } from "./common";

export type RoleName = string;

// Valid role names matching database roles table
export const VALID_ROLE_NAMES = [
	// Admin portal roles
	"admin:superadmin",
	"admin:view_users",
	"admin:manage_users",
	"admin:view_domains",
	"admin:manage_domains",
	"admin:manage_tags",
	"admin:view_audit_logs",
	"admin:manage_marketplace",

	// Org portal roles
	"org:superadmin",
	"org:view_users",
	"org:manage_users",
	"org:view_domains",
	"org:manage_domains",
	"org:view_costcenters",
	"org:manage_costcenters",
	"org:view_suborgs",
	"org:manage_suborgs",
	"org:manage_marketplace",
	"org:view_audit_logs",

	// Hub portal roles
	"hub:read_posts",
	"hub:write_posts",
	"hub:apply_jobs",
] as const;
export type ValidRoleName = (typeof VALID_ROLE_NAMES)[number];

// Validation error messages
export const ERR_ROLE_NAME_INVALID = "must be a valid role name";
export const ERR_TARGET_EMAIL_REQUIRED = "email_address is required";

// Validates role name, returns error message or null
export function validateRoleName(roleName: RoleName): string | null {
	if (!VALID_ROLE_NAMES.includes(roleName as ValidRoleName)) {
		return ERR_ROLE_NAME_INVALID;
	}
	return null;
}

// Request to assign a role to a user
export interface AssignRoleRequest {
	email_address: string;
	role_name: RoleName;
}

// Validates AssignRoleRequest
export function validateAssignRoleRequest(
	request: AssignRoleRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.email_address || request.email_address.trim() === "") {
		errs.push(newValidationError("email_address", ERR_TARGET_EMAIL_REQUIRED));
	}

	if (!request.role_name) {
		errs.push(newValidationError("role_name", ERR_ROLE_NAME_INVALID));
	} else {
		const roleErr = validateRoleName(request.role_name);
		if (roleErr) {
			errs.push(newValidationError("role_name", roleErr));
		}
	}

	return errs;
}

// Request to remove a role from a user
export interface RemoveRoleRequest {
	email_address: string;
	role_name: RoleName;
}

// Validates RemoveRoleRequest
export function validateRemoveRoleRequest(
	request: RemoveRoleRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.email_address || request.email_address.trim() === "") {
		errs.push(newValidationError("email_address", ERR_TARGET_EMAIL_REQUIRED));
	}

	if (!request.role_name) {
		errs.push(newValidationError("role_name", ERR_ROLE_NAME_INVALID));
	} else {
		const roleErr = validateRoleName(request.role_name);
		if (roleErr) {
			errs.push(newValidationError("role_name", roleErr));
		}
	}

	return errs;
}
