export type EmailAddress = string;
export type Password = string;
export type LanguageCode = string;
export type DomainName = string;
export type TFACode = string;

// Validation constraints matching common.tsp
export const EMAIL_MIN_LENGTH = 3;
export const EMAIL_MAX_LENGTH = 256;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 64;
export const LANGUAGE_CODE_MIN_LENGTH = 2;
export const LANGUAGE_CODE_MAX_LENGTH = 10;
export const DOMAIN_MIN_LENGTH = 3;
export const DOMAIN_MAX_LENGTH = 255;
export const TFA_CODE_LENGTH = 6;

const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const LANGUAGE_CODE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
const DOMAIN_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const TFA_CODE_PATTERN = /^[0-9]{6}$/;

// Supported languages (BCP 47 tags)
export const SUPPORTED_LANGUAGES = ["en-US", "de-DE", "ta-IN"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = "en-US";

// Validation error messages (no field context - that's the caller's job)
export const ERR_EMAIL_TOO_SHORT = "must be at least 3 characters";
export const ERR_EMAIL_TOO_LONG = "must be at most 256 characters";
export const ERR_EMAIL_INVALID_FORMAT = "must be a valid email address";
export const ERR_PASSWORD_TOO_SHORT = "must be at least 12 characters";
export const ERR_PASSWORD_TOO_LONG = "must be at most 64 characters";
export const ERR_REQUIRED = "is required";
export const ERR_TFA_CODE_INVALID_LENGTH = "must be exactly 6 characters";
export const ERR_TFA_CODE_INVALID_FORMAT = "must contain only digits";
export const ERR_LANGUAGE_CODE_INVALID = "must be a valid language code";
export const ERR_LANGUAGE_NOT_SUPPORTED = "language not supported";
export const ERR_DOMAIN_TOO_SHORT = "must be at least 3 characters";
export const ERR_DOMAIN_TOO_LONG = "must be at most 255 characters";
export const ERR_DOMAIN_INVALID_FORMAT = "must be a valid domain name in lowercase";

// ValidationError represents a validation failure with field context
export interface ValidationError {
	field: string;
	message: string;
}

// Helper to create a ValidationError by combining field name with an error message
export function newValidationError(
	field: string,
	message: string,
): ValidationError {
	return { field, message };
}

// Validates email address, returns error message or null (no field context)
export function validateEmailAddress(email: EmailAddress): string | null {
	if (email.length < EMAIL_MIN_LENGTH) {
		return ERR_EMAIL_TOO_SHORT;
	}
	if (email.length > EMAIL_MAX_LENGTH) {
		return ERR_EMAIL_TOO_LONG;
	}
	if (!EMAIL_PATTERN.test(email)) {
		return ERR_EMAIL_INVALID_FORMAT;
	}
	return null;
}

// Validates password, returns error message or null (no field context)
export function validatePassword(password: Password): string | null {
	if (password.length < PASSWORD_MIN_LENGTH) {
		return ERR_PASSWORD_TOO_SHORT;
	}
	if (password.length > PASSWORD_MAX_LENGTH) {
		return ERR_PASSWORD_TOO_LONG;
	}
	return null;
}

// Validates language code format and checks if it's supported
export function validateLanguageCode(code: LanguageCode): string | null {
	if (!LANGUAGE_CODE_PATTERN.test(code)) {
		return ERR_LANGUAGE_CODE_INVALID;
	}
	if (!SUPPORTED_LANGUAGES.includes(code as SupportedLanguage)) {
		return ERR_LANGUAGE_NOT_SUPPORTED;
	}
	return null;
}

// Validates domain name, returns error message or null (no field context)
export function validateDomainName(domain: DomainName): string | null {
	if (domain.length < DOMAIN_MIN_LENGTH) {
		return ERR_DOMAIN_TOO_SHORT;
	}
	if (domain.length > DOMAIN_MAX_LENGTH) {
		return ERR_DOMAIN_TOO_LONG;
	}
	// Check if lowercase
	if (domain !== domain.toLowerCase()) {
		return ERR_DOMAIN_INVALID_FORMAT;
	}
	if (!DOMAIN_NAME_PATTERN.test(domain)) {
		return ERR_DOMAIN_INVALID_FORMAT;
	}
	return null;
}

// Validates TFA code, returns error message or null (no field context)
export function validateTFACode(code: TFACode): string | null {
	if (code.length !== TFA_CODE_LENGTH) {
		return ERR_TFA_CODE_INVALID_LENGTH;
	}
	if (!TFA_CODE_PATTERN.test(code)) {
		return ERR_TFA_CODE_INVALID_FORMAT;
	}
	return null;
}
