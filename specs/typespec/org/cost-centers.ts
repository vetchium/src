import { type ValidationError, newValidationError } from "../common/common";

const COST_CENTER_ID_MAX_LENGTH = 64;
const COST_CENTER_DISPLAY_NAME_MAX_LENGTH = 64;
const COST_CENTER_NOTES_MAX_LENGTH = 500;

const COST_CENTER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export const ERR_COST_CENTER_ID_REQUIRED = "id is required";
export const ERR_COST_CENTER_ID_TOO_LONG = "id must be at most 64 characters";
export const ERR_COST_CENTER_ID_INVALID =
	"id must only contain lowercase letters, numbers, hyphens, and underscores, and must start with a letter or number";
export const ERR_COST_CENTER_DISPLAY_NAME_REQUIRED = "display_name is required";
export const ERR_COST_CENTER_DISPLAY_NAME_TOO_LONG =
	"display_name must be at most 64 characters";
export const ERR_COST_CENTER_NOTES_TOO_LONG =
	"notes must be at most 500 characters";
export const ERR_COST_CENTER_STATUS_INVALID =
	"status must be 'enabled' or 'disabled'";

export type CostCenterStatus = "enabled" | "disabled";

export const CostCenterStatusEnabled: CostCenterStatus = "enabled";
export const CostCenterStatusDisabled: CostCenterStatus = "disabled";

// CostCenter is the response type for cost center reads.
export interface CostCenter {
	id: string;
	display_name: string;
	status: CostCenterStatus;
	notes?: string;
	created_at: string;
}

// AddCostCenterRequest is the request body for POST /org/add-cost-center.
export interface AddCostCenterRequest {
	id: string;
	display_name: string;
	notes?: string;
}

export function validateAddCostCenterRequest(
	request: AddCostCenterRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.id) {
		errs.push(newValidationError("id", ERR_COST_CENTER_ID_REQUIRED));
		return errs;
	}
	if (request.id.length > COST_CENTER_ID_MAX_LENGTH) {
		errs.push(newValidationError("id", ERR_COST_CENTER_ID_TOO_LONG));
	} else if (!COST_CENTER_ID_PATTERN.test(request.id)) {
		errs.push(newValidationError("id", ERR_COST_CENTER_ID_INVALID));
	}

	if (!request.display_name) {
		errs.push(
			newValidationError("display_name", ERR_COST_CENTER_DISPLAY_NAME_REQUIRED)
		);
	} else if (
		request.display_name.length > COST_CENTER_DISPLAY_NAME_MAX_LENGTH
	) {
		errs.push(
			newValidationError("display_name", ERR_COST_CENTER_DISPLAY_NAME_TOO_LONG)
		);
	}

	if (
		request.notes !== undefined &&
		request.notes.length > COST_CENTER_NOTES_MAX_LENGTH
	) {
		errs.push(newValidationError("notes", ERR_COST_CENTER_NOTES_TOO_LONG));
	}

	return errs;
}

// UpdateCostCenterRequest is the request body for POST /org/update-cost-center.
export interface UpdateCostCenterRequest {
	id: string;
	display_name: string;
	status: CostCenterStatus;
	notes?: string;
}

export function validateUpdateCostCenterRequest(
	request: UpdateCostCenterRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.id) {
		errs.push(newValidationError("id", ERR_COST_CENTER_ID_REQUIRED));
		return errs;
	}
	if (request.id.length > COST_CENTER_ID_MAX_LENGTH) {
		errs.push(newValidationError("id", ERR_COST_CENTER_ID_TOO_LONG));
	} else if (!COST_CENTER_ID_PATTERN.test(request.id)) {
		errs.push(newValidationError("id", ERR_COST_CENTER_ID_INVALID));
	}

	if (!request.display_name) {
		errs.push(
			newValidationError("display_name", ERR_COST_CENTER_DISPLAY_NAME_REQUIRED)
		);
	} else if (
		request.display_name.length > COST_CENTER_DISPLAY_NAME_MAX_LENGTH
	) {
		errs.push(
			newValidationError("display_name", ERR_COST_CENTER_DISPLAY_NAME_TOO_LONG)
		);
	}

	if (
		!request.status ||
		(request.status !== CostCenterStatusEnabled &&
			request.status !== CostCenterStatusDisabled)
	) {
		errs.push(newValidationError("status", ERR_COST_CENTER_STATUS_INVALID));
	}

	if (
		request.notes !== undefined &&
		request.notes.length > COST_CENTER_NOTES_MAX_LENGTH
	) {
		errs.push(newValidationError("notes", ERR_COST_CENTER_NOTES_TOO_LONG));
	}

	return errs;
}

// ListCostCentersRequest is the request body for POST /org/list-cost-centers.
export interface ListCostCentersRequest {
	cursor?: string;
	filter_status?: CostCenterStatus;
	limit?: number;
}

export function validateListCostCentersRequest(
	request: ListCostCentersRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (
		request.filter_status !== undefined &&
		request.filter_status !== CostCenterStatusEnabled &&
		request.filter_status !== CostCenterStatusDisabled
	) {
		errs.push(
			newValidationError("filter_status", ERR_COST_CENTER_STATUS_INVALID)
		);
	}

	return errs;
}

// ListCostCentersResponse is the response for POST /org/list-cost-centers.
export interface ListCostCentersResponse {
	items: CostCenter[];
	next_cursor: string;
}
