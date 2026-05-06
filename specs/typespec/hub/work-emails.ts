import {
	type ValidationError,
	newValidationError,
	ERR_REQUIRED,
} from "../common/common";

export type WorkEmailStintStatus = "pending_verification" | "active" | "ended";

export type WorkEmailStintEndedReason =
	| "user_removed"
	| "user_removed_pending"
	| "verification_expired"
	| "reverify_timeout"
	| "superseded";

export interface WorkEmailStintOwnerView {
	stint_id: string;
	email_address: string;
	domain: string;
	status: WorkEmailStintStatus;
	first_verified_at?: string;
	last_verified_at?: string;
	ended_at?: string;
	ended_reason?: WorkEmailStintEndedReason;
	pending_code_expires_at?: string;
	pending_code_attempts_remaining?: number;
	reverify_challenge_issued_at?: string;
	reverify_challenge_expires_at?: string;
	created_at: string;
	updated_at: string;
}

export interface PublicEmployerStint {
	domain: string;
	is_current: boolean;
	start_year: number;
	end_year?: number;
}

export interface AddWorkEmailRequest {
	email_address: string;
}

export interface AddWorkEmailResponse {
	stint_id: string;
	pending_code_expires_at: string;
}

export interface VerifyWorkEmailRequest {
	stint_id: string;
	code: string;
}

export interface ResendWorkEmailCodeRequest {
	stint_id: string;
}

export interface ReverifyWorkEmailRequest {
	stint_id: string;
	code: string;
}

export interface RemoveWorkEmailRequest {
	stint_id: string;
}

export interface GetMyWorkEmailRequest {
	stint_id: string;
}

export interface ListMyWorkEmailsRequest {
	filter_status?: WorkEmailStintStatus[];
	filter_domain?: string;
	pagination_key?: string;
	limit?: number;
}

export interface ListMyWorkEmailsResponse {
	work_emails: WorkEmailStintOwnerView[];
	next_pagination_key?: string;
}

export interface ListPublicEmployerStintsRequest {
	handle: string;
}

export interface ListPublicEmployerStintsResponse {
	stints: PublicEmployerStint[];
}

// Validation constants
export const EMAIL_MAX_LENGTH = 254;
export const CODE_LENGTH = 6;
export const ERR_EMAIL_REQUIRED = "email_address is required";
export const ERR_EMAIL_INVALID = "email_address is not a valid email";
export const ERR_EMAIL_TOO_LONG =
	"email_address must be at most 254 characters";
export const ERR_STINT_ID_REQUIRED = "stint_id is required";
export const ERR_CODE_REQUIRED = "code is required";
export const ERR_CODE_INVALID = "code must be a 6-digit number";
export const ERR_HANDLE_REQUIRED = "handle is required";

function isValidEmail(email: string): boolean {
	const parts = email.split("@");
	if (parts.length !== 2) return false;
	const [local, domain] = parts;
	if (!local || !domain) return false;
	if (!domain.includes(".")) return false;
	return true;
}

export function validateAddWorkEmailRequest(
	request: AddWorkEmailRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!request.email_address || request.email_address.trim() === "") {
		errs.push(newValidationError("email_address", ERR_EMAIL_REQUIRED));
	} else if (request.email_address.length > EMAIL_MAX_LENGTH) {
		errs.push(newValidationError("email_address", ERR_EMAIL_TOO_LONG));
	} else if (!isValidEmail(request.email_address)) {
		errs.push(newValidationError("email_address", ERR_EMAIL_INVALID));
	}
	return errs;
}

export function validateVerifyWorkEmailRequest(
	request: VerifyWorkEmailRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!request.stint_id || request.stint_id.trim() === "") {
		errs.push(newValidationError("stint_id", ERR_STINT_ID_REQUIRED));
	}
	if (!request.code || request.code.trim() === "") {
		errs.push(newValidationError("code", ERR_CODE_REQUIRED));
	} else if (!/^\d{6}$/.test(request.code)) {
		errs.push(newValidationError("code", ERR_CODE_INVALID));
	}
	return errs;
}

export function validateResendWorkEmailCodeRequest(
	request: ResendWorkEmailCodeRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!request.stint_id || request.stint_id.trim() === "") {
		errs.push(newValidationError("stint_id", ERR_STINT_ID_REQUIRED));
	}
	return errs;
}

export function validateReverifyWorkEmailRequest(
	request: ReverifyWorkEmailRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!request.stint_id || request.stint_id.trim() === "") {
		errs.push(newValidationError("stint_id", ERR_STINT_ID_REQUIRED));
	}
	if (!request.code || request.code.trim() === "") {
		errs.push(newValidationError("code", ERR_CODE_REQUIRED));
	} else if (!/^\d{6}$/.test(request.code)) {
		errs.push(newValidationError("code", ERR_CODE_INVALID));
	}
	return errs;
}

export function validateRemoveWorkEmailRequest(
	request: RemoveWorkEmailRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!request.stint_id || request.stint_id.trim() === "") {
		errs.push(newValidationError("stint_id", ERR_STINT_ID_REQUIRED));
	}
	return errs;
}

export function validateGetMyWorkEmailRequest(
	request: GetMyWorkEmailRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!request.stint_id || request.stint_id.trim() === "") {
		errs.push(newValidationError("stint_id", ERR_STINT_ID_REQUIRED));
	}
	return errs;
}

export function validateListMyWorkEmailsRequest(
	request: ListMyWorkEmailsRequest
): ValidationError[] {
	// No required fields; limit and pagination_key are optional
	return [];
}

export function validateListPublicEmployerStintsRequest(
	request: ListPublicEmployerStintsRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!request.handle || request.handle.trim() === "") {
		errs.push(newValidationError("handle", ERR_HANDLE_REQUIRED));
	}
	return errs;
}
