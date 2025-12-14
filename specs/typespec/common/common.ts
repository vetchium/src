export type EmailAddress = string;
export type Password = string;

// Validation constraints matching common.tsp
export const EMAIL_MIN_LENGTH = 3;
export const EMAIL_MAX_LENGTH = 256;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 64;

const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// Validation error messages (no field context - that's the caller's job)
export const ERR_EMAIL_TOO_SHORT = "must be at least 3 characters";
export const ERR_EMAIL_TOO_LONG = "must be at most 256 characters";
export const ERR_EMAIL_INVALID_FORMAT = "must be a valid email address";
export const ERR_PASSWORD_TOO_SHORT = "must be at least 12 characters";
export const ERR_PASSWORD_TOO_LONG = "must be at most 64 characters";

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
