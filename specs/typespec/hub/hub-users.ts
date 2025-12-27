import {
	type EmailAddress,
	type Password,
	type DomainName,
	type ValidationError,
	newValidationError,
	validateEmailAddress,
	validatePassword,
	validateDomainName,
	ERR_REQUIRED,
} from "../common/common";

export type { EmailAddress, Password, DomainName, ValidationError };

// Type aliases for signup
export type HubSignupToken = string;
export type HubSessionToken = string;
export type DisplayName = string;
export type CountryCode = string;
export type Handle = string;

// Constants
export const DISPLAY_NAME_MIN_LENGTH = 1;
export const DISPLAY_NAME_MAX_LENGTH = 100;
export const COUNTRY_CODE_LENGTH = 2;
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 50;

// Common email domains to filter client-side (avoids unnecessary API calls)
export const COMMON_EMAIL_DOMAINS = [
	"gmail.com",
	"yahoo.com",
	"outlook.com",
	"hotmail.com",
	"icloud.com",
	"live.com",
	"msn.com",
	"aol.com",
	"protonmail.com",
	"mail.com",
	"yandex.com",
	"gmx.com",
	"zoho.com",
	"inbox.com",
	"fastmail.com",
	"hey.com",
	"tutanota.com",
	"mailfence.com",
	"posteo.de",
	"runbox.com",
];

// Validation error messages
export const ERR_DISPLAY_NAME_TOO_SHORT = "must be at least 1 character";
export const ERR_DISPLAY_NAME_TOO_LONG = "must be at most 100 characters";
export const ERR_COUNTRY_CODE_INVALID = "must be 2 uppercase letters";
export const ERR_HANDLE_INVALID_FORMAT =
	"must contain only lowercase letters, numbers, and hyphens";

// Validation functions
export function validateDisplayName(name: DisplayName): string | null {
	if (name.length < DISPLAY_NAME_MIN_LENGTH) {
		return ERR_DISPLAY_NAME_TOO_SHORT;
	}
	if (name.length > DISPLAY_NAME_MAX_LENGTH) {
		return ERR_DISPLAY_NAME_TOO_LONG;
	}
	return null;
}

export function validateCountryCode(code: CountryCode): string | null {
	if (code.length !== COUNTRY_CODE_LENGTH) {
		return ERR_COUNTRY_CODE_INVALID;
	}
	if (!/^[A-Z]{2}$/.test(code)) {
		return ERR_COUNTRY_CODE_INVALID;
	}
	return null;
}

export function validateHandle(handle: Handle): string | null {
	if (
		handle.length < HANDLE_MIN_LENGTH ||
		handle.length > HANDLE_MAX_LENGTH
	) {
		return ERR_HANDLE_INVALID_FORMAT;
	}
	if (!/^[a-z0-9-]+$/.test(handle)) {
		return ERR_HANDLE_INVALID_FORMAT;
	}
	return null;
}

// Check if email domain is in common list (client-side optimization)
export function isCommonDomain(email: EmailAddress): boolean {
	const parts = email.split("@");
	if (parts.length !== 2) {
		return false;
	}
	const domain = parts[1].toLowerCase();
	return COMMON_EMAIL_DOMAINS.includes(domain);
}

// Interfaces
export interface DisplayNameEntry {
	language_code: string;
	display_name: DisplayName;
	is_preferred: boolean;
}

export interface Region {
	region_code: string;
	region_name: string;
}

export interface SupportedLanguage {
	language_code: string;
	language_name: string;
	native_name: string;
	is_default: boolean;
}

export interface CheckDomainRequest {
	domain: DomainName;
}

export interface CheckDomainResponse {
	is_approved: boolean;
}

export interface RequestSignupRequest {
	email_address: EmailAddress;
}

export interface RequestSignupResponse {
	message: string;
}

export interface CompleteSignupRequest {
	signup_token: HubSignupToken;
	password: Password;
	preferred_display_name: DisplayName;
	other_display_names?: DisplayNameEntry[];
	home_region: string;
	preferred_language: string;
	resident_country_code: CountryCode;
}

export interface CompleteSignupResponse {
	session_token: HubSessionToken;
	handle: Handle;
}

export interface HubLoginRequest {
	email_address: EmailAddress;
	password: Password;
}

export interface HubLoginResponse {
	session_token: HubSessionToken;
}

export interface HubLogoutRequest {
	session_token: HubSessionToken;
}

// Request validators

export function validateCheckDomainRequest(
	request: CheckDomainRequest,
): ValidationError[] {
	const errs: ValidationError[] = [];

	const domainErr = validateDomainName(request.domain);
	if (domainErr) {
		errs.push(newValidationError("domain", domainErr));
	}

	return errs;
}

export function validateRequestSignupRequest(
	request: RequestSignupRequest,
): ValidationError[] {
	const errs: ValidationError[] = [];

	const emailErr = validateEmailAddress(request.email_address);
	if (emailErr) {
		errs.push(newValidationError("email_address", emailErr));
	}

	return errs;
}

export function validateCompleteSignupRequest(
	request: CompleteSignupRequest,
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.signup_token) {
		errs.push(newValidationError("signup_token", ERR_REQUIRED));
	}

	const passwordErr = validatePassword(request.password);
	if (passwordErr) {
		errs.push(newValidationError("password", passwordErr));
	}

	const displayNameErr = validateDisplayName(request.preferred_display_name);
	if (displayNameErr) {
		errs.push(newValidationError("preferred_display_name", displayNameErr));
	}

	if (request.other_display_names) {
		request.other_display_names.forEach((entry, idx) => {
			if (!entry.language_code) {
				errs.push(
					newValidationError(
						`other_display_names[${idx}].language_code`,
						ERR_REQUIRED,
					),
				);
			}

			const nameErr = validateDisplayName(entry.display_name);
			if (nameErr) {
				errs.push(
					newValidationError(`other_display_names[${idx}].display_name`, nameErr),
				);
			}
		});
	}

	if (!request.home_region) {
		errs.push(newValidationError("home_region", ERR_REQUIRED));
	}

	if (!request.preferred_language) {
		errs.push(newValidationError("preferred_language", ERR_REQUIRED));
	}

	const countryErr = validateCountryCode(request.resident_country_code);
	if (countryErr) {
		errs.push(newValidationError("resident_country_code", countryErr));
	}

	return errs;
}

export function validateHubLoginRequest(
	request: HubLoginRequest,
): ValidationError[] {
	const errs: ValidationError[] = [];

	const emailErr = validateEmailAddress(request.email_address);
	if (emailErr) {
		errs.push(newValidationError("email_address", emailErr));
	}

	const passwordErr = validatePassword(request.password);
	if (passwordErr) {
		errs.push(newValidationError("password", passwordErr));
	}

	return errs;
}

export function validateHubLogoutRequest(
	request: HubLogoutRequest,
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.session_token) {
		errs.push(newValidationError("session_token", ERR_REQUIRED));
	}

	return errs;
}

export interface GetRegionsResponse {
	regions: Region[];
}

export interface GetSupportedLanguagesResponse {
	languages: SupportedLanguage[];
}
