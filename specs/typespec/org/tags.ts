import { type ValidationError, newValidationError } from "../common/common";

const TAG_ID_PATTERN = /^[a-z]([a-z0-9-]*[a-z0-9])?$/;
const TAG_ID_MAX_LENGTH = 64;

export const ERR_TAG_ID_REQUIRED = "tag_id is required";
export const ERR_TAG_ID_TOO_LONG = `tag_id must be at most ${TAG_ID_MAX_LENGTH} characters`;
export const ERR_TAG_ID_INVALID_FORMAT =
	"tag_id must contain only lowercase letters, digits, and hyphens, and must not start or end with a hyphen";

export type TagId = string;

export function validateTagId(tagId: TagId): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!tagId) {
		errs.push(newValidationError("tag_id", ERR_TAG_ID_REQUIRED));
		return errs;
	}
	if (tagId.length > TAG_ID_MAX_LENGTH) {
		errs.push(newValidationError("tag_id", ERR_TAG_ID_TOO_LONG));
		return errs;
	}
	if (!TAG_ID_PATTERN.test(tagId)) {
		errs.push(newValidationError("tag_id", ERR_TAG_ID_INVALID_FORMAT));
	}
	return errs;
}

// GetTagRequest is the request body for POST /org/get-tag.
export interface GetTagRequest {
	tag_id: TagId;
	locale?: string;
}

export function validateGetTagRequest(
	request: GetTagRequest
): ValidationError[] {
	return validateTagId(request.tag_id);
}

// FilterTagsRequest is the request body for POST /org/filter-tags.
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

// Tag is the response type for portal tag reads.
export interface Tag {
	tag_id: TagId;
	display_name: string;
	description?: string;
	small_icon_url?: string;
	large_icon_url?: string;
}

// FilterTagsResponse is the response for POST /org/filter-tags.
export interface FilterTagsResponse {
	tags: Tag[];
	pagination_key?: string;
}
