import {
	type ValidationError,
	newValidationError,
	ERR_REQUIRED,
} from "../common/common";

export type CostCenterStatus = "enabled" | "disabled";

export interface CostCenter {
	id: string;
	display_name: string;
	status: CostCenterStatus;
	notes?: string;
	created_at: string;
}

export interface AddCostCenterRequest {
	id: string;
	display_name: string;
	notes?: string;
}

export interface UpdateCostCenterRequest {
	id: string;
	display_name: string;
	status: CostCenterStatus;
	notes?: string;
}

export interface ListCostCentersRequest {
	cursor?: string;
	filter_status?: CostCenterStatus;
	limit?: number;
}

export interface ListCostCentersResponse {
	items: CostCenter[];
	next_cursor: string;
}

const ERR_ID_TOO_LONG = "id must be at most 64 characters";
const ERR_ID_INVALID =
	"id must only contain lowercase letters, numbers, hyphens, and underscores, and must start with a letter or number";
const ERR_DISPLAY_NAME_TOO_LONG = "display_name must be at most 64 characters";
const ERR_NOTES_TOO_LONG = "notes must be at most 500 characters";
const ERR_STATUS_INVALID = "status must be 'enabled' or 'disabled'";

const COST_CENTER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

const VALID_STATUSES: CostCenterStatus[] = ["enabled", "disabled"];

function validateCostCenterStatus(status: string): string | null {
	if (!VALID_STATUSES.includes(status as CostCenterStatus)) {
		return ERR_STATUS_INVALID;
	}
	return null;
}

export function validateAddCostCenterRequest(
	request: AddCostCenterRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.id) {
		errs.push(newValidationError("id", ERR_REQUIRED));
	} else if (request.id.length > 64) {
		errs.push(newValidationError("id", ERR_ID_TOO_LONG));
	} else if (!COST_CENTER_ID_PATTERN.test(request.id)) {
		errs.push(newValidationError("id", ERR_ID_INVALID));
	}

	if (!request.display_name) {
		errs.push(newValidationError("display_name", ERR_REQUIRED));
	} else if (request.display_name.length > 64) {
		errs.push(newValidationError("display_name", ERR_DISPLAY_NAME_TOO_LONG));
	}

	if (request.notes && request.notes.length > 500) {
		errs.push(newValidationError("notes", ERR_NOTES_TOO_LONG));
	}

	return errs;
}

export function validateUpdateCostCenterRequest(
	request: UpdateCostCenterRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.id) {
		errs.push(newValidationError("id", ERR_REQUIRED));
	} else if (request.id.length > 64) {
		errs.push(newValidationError("id", ERR_ID_TOO_LONG));
	} else if (!COST_CENTER_ID_PATTERN.test(request.id)) {
		errs.push(newValidationError("id", ERR_ID_INVALID));
	}

	if (!request.display_name) {
		errs.push(newValidationError("display_name", ERR_REQUIRED));
	} else if (request.display_name.length > 64) {
		errs.push(newValidationError("display_name", ERR_DISPLAY_NAME_TOO_LONG));
	}

	if (!request.status) {
		errs.push(newValidationError("status", ERR_REQUIRED));
	} else {
		const statusErr = validateCostCenterStatus(request.status);
		if (statusErr) {
			errs.push(newValidationError("status", statusErr));
		}
	}

	if (request.notes && request.notes.length > 500) {
		errs.push(newValidationError("notes", ERR_NOTES_TOO_LONG));
	}

	return errs;
}

export function validateListCostCentersRequest(
	request: ListCostCentersRequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (request.filter_status) {
		const statusErr = validateCostCenterStatus(request.filter_status);
		if (statusErr) {
			errs.push(newValidationError("filter_status", statusErr));
		}
	}

	return errs;
}
