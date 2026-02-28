import { type ValidationError, newValidationError } from "../common/common";

const TAG_ID_PATTERN = /^[a-z]([a-z0-9-]*[a-z0-9])?$/;
const TAG_ID_MAX_LENGTH = 64;

export const ERR_TAG_ID_REQUIRED = "tag_id is required";
export const ERR_TAG_ID_INVALID_FORMAT =
	"tag_id must contain only lowercase letters, digits, and hyphens, and must not start or end with a hyphen";
export const ERR_TAG_ID_TOO_LONG = `tag_id must be at most ${TAG_ID_MAX_LENGTH} characters`;

export type TagId = string;

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

export interface GetTagRequest {
	tag_id: TagId;
	locale?: string;
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
	locale?: string;
}

export function validateFilterTagsRequest(
	_request: FilterTagsRequest
): ValidationError[] {
	return [];
}

export interface Tag {
	tag_id: TagId;
	display_name: string;
	description?: string;
	small_icon_url?: string;
	large_icon_url?: string;
}

export interface FilterTagsResponse {
	tags: Tag[];
	pagination_key?: string;
}
