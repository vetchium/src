import {
	type EmailAddress,
	type Password,
	type ValidationError,
	newValidationError,
	validateEmailAddress,
	validatePassword,
	ERR_REQUIRED,
} from "../common/common";

// Import TFA types from common for hub TFA functionality
import type { TFACode, LanguageCode } from "../common/common";
import { validateTFACode, validateLanguageCode } from "../common/common";

// Type aliases for signup
export type HubSignupToken = string;
export type HubTFAToken = string;
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
	if (handle.length < HANDLE_MIN_LENGTH || handle.length > HANDLE_MAX_LENGTH) {
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
	tfa_token: HubTFAToken;
}

export interface HubTFARequest {
	tfa_token: HubTFAToken;
	tfa_code: TFACode;
	remember_me: boolean;
}

export interface HubTFAResponse {
	session_token: HubSessionToken;
	preferred_language: LanguageCode;
}

export interface HubLogoutRequest {
	// Empty interface - session token passed in Authorization header
}

// Request validators

export function validateRequestSignupRequest(
	request: RequestSignupRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	const emailErr = validateEmailAddress(request.email_address);
	if (emailErr) {
		errs.push(newValidationError("email_address", emailErr));
	}

	return errs;
}

export function validateCompleteSignupRequest(
	request: CompleteSignupRequest
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
						ERR_REQUIRED
					)
				);
			}

			const nameErr = validateDisplayName(entry.display_name);
			if (nameErr) {
				errs.push(
					newValidationError(
						`other_display_names[${idx}].display_name`,
						nameErr
					)
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
	request: HubLoginRequest
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

export function validateHubTFARequest(
	request: HubTFARequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.tfa_token) {
		errs.push(newValidationError("tfa_token", ERR_REQUIRED));
	}

	const tfaCodeErr = validateTFACode(request.tfa_code);
	if (tfaCodeErr) {
		errs.push(newValidationError("tfa_code", tfaCodeErr));
	}

	// remember_me is boolean, no validation needed

	return errs;
}

export function validateHubLogoutRequest(
	_request: HubLogoutRequest
): ValidationError[] {
	// No fields to validate
	return [];
}

export interface HubSetLanguageRequest {
	language: LanguageCode;
}

export function validateHubSetLanguageRequest(
	request: HubSetLanguageRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!request.language) {
		errs.push(newValidationError("language", ERR_REQUIRED));
	} else {
		const langErr = validateLanguageCode(request.language);
		if (langErr) {
			errs.push(newValidationError("language", langErr));
		}
	}
	return errs;
}
