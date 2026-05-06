import type {
	ValidationError,
	CountryCode,
	LanguageCode,
} from "../common/common";
import { newValidationError } from "../common/common";
import type { DisplayNameEntry, Handle } from "./hub-users";
import {
	validateDisplayName,
	validateCountryCode,
	validateHandle,
} from "./hub-users";

// ============================================================================
// Interfaces
// ============================================================================

export interface HubProfileOwnerView {
	handle: Handle;
	display_names: DisplayNameEntry[];
	short_bio?: string;
	long_bio?: string;
	city?: string;
	resident_country_code?: CountryCode;
	has_profile_picture: boolean;
	preferred_language: LanguageCode;
	created_at: string;
	updated_at: string;
}

export interface HubProfilePublicView {
	handle: Handle;
	display_names: DisplayNameEntry[];
	short_bio?: string;
	long_bio?: string;
	city?: string;
	resident_country_code?: CountryCode;
	profile_picture_url?: string;
}

export interface UpdateMyProfileRequest {
	display_names?: DisplayNameEntry[];
	short_bio?: string;
	long_bio?: string;
	city?: string;
	resident_country_code?: CountryCode;
}

export interface GetProfileRequest {
	handle: Handle;
}

// ============================================================================
// Constants
// ============================================================================

export const SHORT_BIO_MAX_LENGTH = 160;
export const LONG_BIO_MAX_LENGTH = 4000;
export const CITY_MAX_LENGTH = 100;
export const LANGUAGE_CODE_MAX_LENGTH = 35;
export const DISPLAY_NAMES_MAX_COUNT = 10;

// ============================================================================
// Field validators
// ============================================================================

export function validateShortBio(bio: string): string | null {
	if (bio.length > SHORT_BIO_MAX_LENGTH) {
		return `must be at most ${SHORT_BIO_MAX_LENGTH} characters`;
	}
	return null;
}

export function validateLongBio(bio: string): string | null {
	if (bio.length > LONG_BIO_MAX_LENGTH) {
		return `must be at most ${LONG_BIO_MAX_LENGTH} characters`;
	}
	return null;
}

export function validateCity(city: string): string | null {
	if (city.length > CITY_MAX_LENGTH) {
		return `must be at most ${CITY_MAX_LENGTH} characters`;
	}
	return null;
}

export function validateDisplayNames(
	entries: DisplayNameEntry[]
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (entries.length === 0) {
		errs.push(
			newValidationError(
				"display_names",
				"at least one display name is required"
			)
		);
		return errs;
	}

	if (entries.length > DISPLAY_NAMES_MAX_COUNT) {
		errs.push(
			newValidationError(
				"display_names",
				`at most ${DISPLAY_NAMES_MAX_COUNT} display names are allowed`
			)
		);
	}

	const preferredCount = entries.filter((e) => e.is_preferred).length;
	if (preferredCount !== 1) {
		errs.push(
			newValidationError(
				"display_names",
				"exactly one display name must be marked as preferred"
			)
		);
	}

	const seenLanguages = new Set<string>();
	entries.forEach((entry, idx) => {
		if (!entry.language_code) {
			errs.push(
				newValidationError(
					`display_names[${idx}].language_code`,
					"language code is required"
				)
			);
		} else {
			if (entry.language_code.length > LANGUAGE_CODE_MAX_LENGTH) {
				errs.push(
					newValidationError(
						`display_names[${idx}].language_code`,
						`must be at most ${LANGUAGE_CODE_MAX_LENGTH} characters`
					)
				);
			}
			if (seenLanguages.has(entry.language_code)) {
				errs.push(
					newValidationError(
						`display_names[${idx}].language_code`,
						"duplicate language code"
					)
				);
			} else {
				seenLanguages.add(entry.language_code);
			}
		}

		const nameErr = validateDisplayName(entry.display_name);
		if (nameErr) {
			errs.push(
				newValidationError(`display_names[${idx}].display_name`, nameErr)
			);
		}
	});

	return errs;
}

// ============================================================================
// Request validators
// ============================================================================

export function validateUpdateMyProfileRequest(
	request: UpdateMyProfileRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (request.display_names !== undefined) {
		const dnErrs = validateDisplayNames(request.display_names);
		errs.push(...dnErrs);
	}

	if (request.short_bio !== undefined) {
		const bioErr = validateShortBio(request.short_bio);
		if (bioErr) {
			errs.push(newValidationError("short_bio", bioErr));
		}
	}

	if (request.long_bio !== undefined) {
		const bioErr = validateLongBio(request.long_bio);
		if (bioErr) {
			errs.push(newValidationError("long_bio", bioErr));
		}
	}

	if (request.city !== undefined) {
		const cityErr = validateCity(request.city);
		if (cityErr) {
			errs.push(newValidationError("city", cityErr));
		}
	}

	if (request.resident_country_code !== undefined) {
		const countryErr = validateCountryCode(request.resident_country_code);
		if (countryErr) {
			errs.push(newValidationError("resident_country_code", countryErr));
		}
	}

	return errs;
}

export function validateGetProfileRequest(
	request: GetProfileRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	const handleErr = validateHandle(request.handle);
	if (handleErr) {
		errs.push(newValidationError("handle", handleErr));
	}

	return errs;
}
