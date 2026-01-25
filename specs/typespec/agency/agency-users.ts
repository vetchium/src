import {
	type EmailAddress,
	type Password,
	type FullName,
	type DomainName,
	type TFACode,
	type LanguageCode,
	type ValidationError,
	newValidationError,
	validateEmailAddress,
	validateEmployerEmail,
	validatePassword,
	validateFullName,
	validateDomainName,
	validateTFACode,
	validateLanguageCode,
	ERR_REQUIRED,
} from "../common/common";
import {
	type RoleName,
	type AssignRoleRequest,
	type RemoveRoleRequest,
	validateAssignRoleRequest,
	validateRemoveRoleRequest,
} from "../common/roles";

// ... (omitted sections)

export interface AgencyInviteUserRequest {
	email_address: EmailAddress;
	full_name: FullName;
	preferred_language?: LanguageCode;
}

export function validateAgencyInviteUserRequest(
	request: AgencyInviteUserRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.email_address) {
		errs.push(newValidationError("email_address", ERR_REQUIRED));
	} else {
		const emailErr = validateEmailAddress(request.email_address);
		if (emailErr) {
			errs.push(newValidationError("email_address", emailErr));
		}
	}

	if (!request.full_name) {
		errs.push(newValidationError("full_name", ERR_REQUIRED));
	} else {
		const fullNameErr = validateFullName(request.full_name);
		if (fullNameErr) {
			errs.push(newValidationError("full_name", fullNameErr));
		}
	}

	if (request.preferred_language) {
		const langErr = validateLanguageCode(request.preferred_language);
		if (langErr) {
			errs.push(newValidationError("preferred_language", langErr));
		}
	}

	return errs;
}

// ... (omitted sections)

export interface AgencyUser {
	email_address: EmailAddress;
	name: string;
	status: string;
	created_at: string;
	roles: RoleName[];
}

export interface FilterAgencyUsersRequest {
	limit?: number;
	cursor?: string;
	filter_email?: string;
	filter_name?: string;
	filter_status?: string;
}

export function validateFilterAgencyUsersRequest(
	request: FilterAgencyUsersRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	// Optional fields, default validation
	return errs;
}

export interface FilterAgencyUsersResponse {
	items: AgencyUser[];
	next_cursor: string;
}
