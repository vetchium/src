import {
	type ValidationError,
	newValidationError,
	ERR_REQUIRED,
} from "../common/common";

// Tag ID: lowercase letters and hyphens, no leading/trailing hyphens, 1-64 chars
const TAG_ID_PATTERN = /^[a-z]([a-z0-9-]*[a-z0-9])?$/;
const TAG_ID_MAX_LENGTH = 64;

export const ERR_TAG_ID_REQUIRED = "tag_id is required";
export const ERR_TAG_ID_INVALID_FORMAT =
	"tag_id must contain only lowercase letters, digits, and hyphens, and must not start or end with a hyphen";
export const ERR_TAG_ID_TOO_LONG = `tag_id must be at most ${TAG_ID_MAX_LENGTH} characters`;
export const ERR_TRANSLATIONS_REQUIRED = "at least one translation is required";
export const ERR_EN_US_TRANSLATION_REQUIRED = "en-US translation is required";
export const ERR_DISPLAY_NAME_REQUIRED = "display_name is required";
export const ERR_DISPLAY_NAME_TOO_LONG =
	"display_name must be at most 100 characters";
export const ERR_DESCRIPTION_TOO_LONG =
	"description must be at most 500 characters";
export const ERR_LOCALE_REQUIRED = "locale is required";
export const ERR_ICON_SIZE_INVALID = "icon_size must be 'small' or 'large'";

export type TagId = string;
export type IconSize = "small" | "large";

export interface TagTranslation {
	locale: string;
	display_name: string;
	description?: string;
}

export function validateTagTranslation(
	translation: TagTranslation,
	index: number
): ValidationError[] {
	const errs: ValidationError[] = [];
	const prefix = `translations[${index}]`;

	if (!translation.locale || translation.locale.trim() === "") {
		errs.push(newValidationError(`${prefix}.locale`, ERR_LOCALE_REQUIRED));
	}

	if (!translation.display_name || translation.display_name.trim() === "") {
		errs.push(
			newValidationError(`${prefix}.display_name`, ERR_DISPLAY_NAME_REQUIRED)
		);
	} else if (translation.display_name.length > 100) {
		errs.push(
			newValidationError(`${prefix}.display_name`, ERR_DISPLAY_NAME_TOO_LONG)
		);
	}

	if (
		translation.description !== undefined &&
		translation.description !== null
	) {
		if (translation.description.length > 500) {
			errs.push(
				newValidationError(`${prefix}.description`, ERR_DESCRIPTION_TOO_LONG)
			);
		}
	}

	return errs;
}

export function validateTagId(tagId: TagId): string | null {
	if (!tagId || tagId.trim() === "") {
		return ERR_TAG_ID_REQUIRED;
	}
	if (tagId.length > TAG_ID_MAX_LENGTH) {
		return ERR_TAG_ID_TOO_LONG;
	}
	if (!TAG_ID_PATTERN.test(tagId)) {
		return ERR_TAG_ID_INVALID_FORMAT;
	}
	return null;
}

export interface CreateTagRequest {
	tag_id: TagId;
	translations: TagTranslation[];
}

export function validateCreateTagRequest(
	request: CreateTagRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	const tagIdErr = validateTagId(request.tag_id);
	if (tagIdErr) {
		errs.push(newValidationError("tag_id", tagIdErr));
	}

	if (!request.translations || request.translations.length === 0) {
		errs.push(newValidationError("translations", ERR_TRANSLATIONS_REQUIRED));
	} else {
		const hasEnUS = request.translations.some((t) => t.locale === "en-US");
		if (!hasEnUS) {
			errs.push(
				newValidationError("translations", ERR_EN_US_TRANSLATION_REQUIRED)
			);
		}
		request.translations.forEach((translation, index) => {
			const translationErrs = validateTagTranslation(translation, index);
			errs.push(...translationErrs);
		});
	}

	return errs;
}

export interface UpdateTagRequest {
	tag_id: TagId;
	translations: TagTranslation[];
}

export function validateUpdateTagRequest(
	request: UpdateTagRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	const tagIdErr = validateTagId(request.tag_id);
	if (tagIdErr) {
		errs.push(newValidationError("tag_id", tagIdErr));
	}

	if (!request.translations || request.translations.length === 0) {
		errs.push(newValidationError("translations", ERR_TRANSLATIONS_REQUIRED));
	} else {
		const hasEnUS = request.translations.some((t) => t.locale === "en-US");
		if (!hasEnUS) {
			errs.push(
				newValidationError("translations", ERR_EN_US_TRANSLATION_REQUIRED)
			);
		}
		request.translations.forEach((translation, index) => {
			const translationErrs = validateTagTranslation(translation, index);
			errs.push(...translationErrs);
		});
	}

	return errs;
}

export interface GetTagRequest {
	tag_id: TagId;
}

export function validateGetTagRequest(
	request: GetTagRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	const tagIdErr = validateTagId(request.tag_id);
	if (tagIdErr) {
		errs.push(newValidationError("tag_id", tagIdErr));
	}

	return errs;
}

export interface FilterTagsRequest {
	query?: string;
	pagination_key?: string;
}

export function validateFilterTagsRequest(
	_request: FilterTagsRequest
): ValidationError[] {
	return [];
}

export interface DeleteTagIconRequest {
	tag_id: TagId;
	icon_size: IconSize;
}

export function validateDeleteTagIconRequest(
	request: DeleteTagIconRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	const tagIdErr = validateTagId(request.tag_id);
	if (tagIdErr) {
		errs.push(newValidationError("tag_id", tagIdErr));
	}

	if (request.icon_size !== "small" && request.icon_size !== "large") {
		errs.push(newValidationError("icon_size", ERR_ICON_SIZE_INVALID));
	}

	return errs;
}

export interface AdminTag {
	tag_id: TagId;
	translations: TagTranslation[];
	small_icon_url?: string;
	large_icon_url?: string;
	created_at: string;
	updated_at: string;
}

export interface FilterTagsResponse {
	tags: AdminTag[];
	pagination_key?: string;
}

// Re-export ValidationError for use in consumers
export type { ValidationError };
export { ERR_REQUIRED };
