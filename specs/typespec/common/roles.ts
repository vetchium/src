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

	// Employer portal roles
	"employer:superadmin",
	"employer:view_users",
	"employer:manage_users",
	"employer:view_domains",
	"employer:manage_domains",

	// Agency portal roles
	"agency:superadmin",
	"agency:view_users",
	"agency:manage_users",
	"agency:view_domains",
	"agency:manage_domains",

	// Hub portal roles
	"hub:read_posts",
	"hub:write_posts",
	"hub:apply_jobs",
] as const;
export type ValidRoleName = (typeof VALID_ROLE_NAMES)[number];

// Validation error messages
export const ERR_ROLE_NAME_INVALID = "must be a valid role name";
export const ERR_TARGET_USER_ID_REQUIRED = "target user ID is required";

// Validates role name, returns error message or null
export function validateRoleName(roleName: RoleName): string | null {
	if (!VALID_ROLE_NAMES.includes(roleName as ValidRoleName)) {
		return ERR_ROLE_NAME_INVALID;
	}
	return null;
}

// Request to assign a role to a user
export interface AssignRoleRequest {
	target_user_id: string;
	role_name: RoleName;
}

// Validates AssignRoleRequest
export function validateAssignRoleRequest(
	request: AssignRoleRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.target_user_id || request.target_user_id.trim() === "") {
		errs.push(
			newValidationError("target_user_id", ERR_TARGET_USER_ID_REQUIRED)
		);
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
	target_user_id: string;
	role_name: RoleName;
}

// Validates RemoveRoleRequest
export function validateRemoveRoleRequest(
	request: RemoveRoleRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.target_user_id || request.target_user_id.trim() === "") {
		errs.push(
			newValidationError("target_user_id", ERR_TARGET_USER_ID_REQUIRED)
		);
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
