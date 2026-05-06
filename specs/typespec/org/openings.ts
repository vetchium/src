import { type ValidationError, newValidationError } from "../common/common";
import type { OrgAddress } from "./company-addresses";
import type { CostCenter } from "./cost-centers";

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 10000;
const INTERNAL_NOTES_MAX = 2000;
const REJECTION_NOTE_MAX = 2000;
const ADDRESS_IDS_MIN = 1;
const ADDRESS_IDS_MAX = 10;
const HIRING_TEAM_MAX = 10;
const WATCHERS_MAX = 25;
const TAG_IDS_MAX = 20;
const YOE_MIN = 0;
const YOE_MAX = 100;
const POSITIONS_MAX = 100;

export type OpeningStatus = "draft" | "pending_review" | "published" | "paused" | "expired" | "closed" | "archived";
export const OpeningStatusDraft: OpeningStatus = "draft";
export const OpeningStatusPendingReview: OpeningStatus = "pending_review";
export const OpeningStatusPublished: OpeningStatus = "published";
export const OpeningStatusPaused: OpeningStatus = "paused";
export const OpeningStatusExpired: OpeningStatus = "expired";
export const OpeningStatusClosed: OpeningStatus = "closed";
export const OpeningStatusArchived: OpeningStatus = "archived";

export type EmploymentType = "full_time" | "part_time" | "contract" | "internship";
export const EmploymentTypeFullTime: EmploymentType = "full_time";
export const EmploymentTypePartTime: EmploymentType = "part_time";
export const EmploymentTypeContract: EmploymentType = "contract";
export const EmploymentTypeInternship: EmploymentType = "internship";

export type WorkLocationType = "remote" | "on_site" | "hybrid";
export const WorkLocationTypeRemote: WorkLocationType = "remote";
export const WorkLocationTypeOnSite: WorkLocationType = "on_site";
export const WorkLocationTypeHybrid: WorkLocationType = "hybrid";

export type EducationLevel = "not_required" | "bachelor" | "master" | "doctorate";
export const EducationLevelNotRequired: EducationLevel = "not_required";
export const EducationLevelBachelor: EducationLevel = "bachelor";
export const EducationLevelMaster: EducationLevel = "master";
export const EducationLevelDoctorate: EducationLevel = "doctorate";

export interface Salary {
	min_amount: number;
	max_amount: number;
	currency: string;
}

export interface CreateOpeningRequest {
	title: string;
	description: string;
	is_internal: boolean;
	employment_type: EmploymentType;
	work_location_type: WorkLocationType;
	address_ids: string[];
	min_yoe?: number;
	max_yoe?: number;
	min_education_level?: EducationLevel;
	salary?: Salary;
	number_of_positions: number;
	hiring_manager_org_user_id: string;
	recruiter_org_user_id: string;
	hiring_team_member_ids?: string[];
	watcher_ids?: string[];
	cost_center_id?: string;
	tag_ids?: string[];
	internal_notes?: string;
}

export interface CreateOpeningResponse {
	opening_id: string;
	opening_number: number;
}

export interface OpeningSummary {
	opening_id: string;
	opening_number: number;
	title: string;
	is_internal: boolean;
	status: OpeningStatus;
	employment_type: EmploymentType;
	work_location_type: WorkLocationType;
	number_of_positions: number;
	filled_positions: number;
	hiring_manager: OrgUserShort;
	recruiter: OrgUserShort;
	primary_address_city?: string;
	created_at: string;
	first_published_at?: string;
}

export interface Opening {
	opening_id: string;
	opening_number: number;
	title: string;
	description: string;
	is_internal: boolean;
	status: OpeningStatus;
	employment_type: EmploymentType;
	work_location_type: WorkLocationType;
	addresses: OrgAddress[];
	min_yoe?: number;
	max_yoe?: number;
	min_education_level?: EducationLevel;
	salary?: Salary;
	number_of_positions: number;
	filled_positions: number;
	hiring_manager: OrgUserShort;
	recruiter: OrgUserShort;
	hiring_team_members: OrgUserShort[];
	watchers: OrgUserShort[];
	cost_center?: CostCenter;
	tags: OrgTag[];
	internal_notes?: string;
	rejection_note?: string;
	created_at: string;
	updated_at: string;
	first_published_at?: string;
}

export interface UpdateOpeningRequest {
	opening_number: number;
	title: string;
	description: string;
	employment_type: EmploymentType;
	work_location_type: WorkLocationType;
	address_ids: string[];
	min_yoe?: number;
	max_yoe?: number;
	min_education_level?: EducationLevel;
	salary?: Salary;
	number_of_positions: number;
	hiring_manager_org_user_id: string;
	recruiter_org_user_id: string;
	hiring_team_member_ids?: string[];
	watcher_ids?: string[];
	cost_center_id?: string;
	tag_ids?: string[];
	internal_notes?: string;
}

export interface ListOpeningsRequest {
	filter_status?: OpeningStatus[];
	filter_is_internal?: boolean;
	filter_hiring_manager_org_user_id?: string;
	filter_recruiter_org_user_id?: string;
	filter_tag_ids?: string[];
	filter_title_prefix?: string;
	pagination_key?: string;
	limit?: number;
}

export interface ListOpeningsResponse {
	openings: OpeningSummary[];
	next_pagination_key?: string;
}

export interface OpeningNumberRequest {
	opening_number: number;
}

export interface RejectOpeningRequest {
	opening_number: number;
	rejection_note: string;
}

// Error messages
export const ERR_TITLE_REQUIRED = "title is required";
export const ERR_TITLE_TOO_LONG = `title must be at most ${TITLE_MAX} characters`;
export const ERR_DESCRIPTION_REQUIRED = "description is required";
export const ERR_DESCRIPTION_TOO_LONG = `description must be at most ${DESCRIPTION_MAX} characters`;
export const ERR_IS_INTERNAL_REQUIRED = "is_internal is required";
export const ERR_EMPLOYMENT_TYPE_REQUIRED = "employment_type is required";
export const ERR_EMPLOYMENT_TYPE_INVALID = "employment_type must be 'full_time', 'part_time', 'contract', or 'internship'";
export const ERR_WORK_LOCATION_TYPE_REQUIRED = "work_location_type is required";
export const ERR_WORK_LOCATION_TYPE_INVALID = "work_location_type must be 'remote', 'on_site', or 'hybrid'";
export const ERR_ADDRESS_IDS_REQUIRED = "address_ids is required";
export const ERR_ADDRESS_IDS_TOO_SHORT = `address_ids must have at least ${ADDRESS_IDS_MIN} entry`;
export const ERR_ADDRESS_IDS_TOO_LONG = `address_ids must have at most ${ADDRESS_IDS_MAX} entries`;
export const ERR_ADDRESS_ID_INVALID = "each address_id must be a valid UUID";
export const ERR_ADDRESS_ID_DUPLICATE = "address_ids contains duplicate values";
export const ERR_MIN_YOE_INVALID = `min_yoe must be between ${YOE_MIN} and ${YOE_MAX}`;
export const ERR_MAX_YOE_INVALID = `max_yoe must be between ${YOE_MIN + 1} and ${YOE_MAX}`;
export const ERR_MAX_YOE_LESS_THAN_MIN = "max_yoe must be greater than or equal to min_yoe";
export const ERR_MIN_EDUCATION_LEVEL_INVALID = "min_education_level must be 'not_required', 'bachelor', 'master', or 'doctorate'";
export const ERR_SALARY_MIN_REQUIRED = "salary_min_amount is required if salary is provided";
export const ERR_SALARY_MAX_REQUIRED = "salary_max_amount is required if salary is provided";
export const ERR_SALARY_CURRENCY_REQUIRED = "salary_currency is required if salary is provided";
export const ERR_SALARY_MIN_POSITIVE = "salary_min_amount must be greater than 0";
export const ERR_SALARY_MAX_INVALID = "salary_max_amount must be greater than or equal to salary_min_amount";
export const ERR_SALARY_CURRENCY_INVALID = "salary_currency must be a 3-character ISO 4217 code";
export const ERR_SALARY_PARTIAL = "either all salary fields or none must be provided";
export const ERR_SALARY_MIN_AMOUNT_REQUIRED = "salary_min_amount is required if any salary field is provided";
export const ERR_SALARY_MAX_AMOUNT_REQUIRED = "salary_max_amount is required if any salary field is provided";
export const ERR_NUMBER_OF_POSITIONS_REQUIRED = "number_of_positions is required";
export const ERR_NUMBER_OF_POSITIONS_INVALID = `number_of_positions must be between 1 and ${POSITIONS_MAX}`;
export const ERR_HIRING_MANAGER_REQUIRED = "hiring_manager_org_user_id is required";
export const ERR_HIRING_MANAGER_INVALID = "hiring_manager_org_user_id must be a valid UUID";
export const ERR_RECRUITER_REQUIRED = "recruiter_org_user_id is required";
export const ERR_RECRUITER_INVALID = "recruiter_org_user_id must be a valid UUID";
export const ERR_HIRING_TEAM_TOO_LONG = `hiring_team_member_ids must have at most ${HIRING_TEAM_MAX} entries`;
export const ERR_HIRING_TEAM_INVALID = "each hiring_team_member_id must be a valid UUID";
export const ERR_HIRING_TEAM_DUPLICATE = "hiring_team_member_ids contains duplicate values";
export const ERR_HIRING_TEAM_OVERLAPS_MANAGER = "hiring_team_member_ids cannot include the hiring_manager";
export const ERR_HIRING_TEAM_OVERLAPS_RECRUITER = "hiring_team_member_ids cannot include the recruiter";
export const ERR_MANAGER_EQUALS_RECRUITER = "hiring_manager and recruiter must be different users";
export const ERR_WATCHERS_TOO_LONG = `watcher_ids must have at most ${WATCHERS_MAX} entries`;
export const ERR_WATCHERS_INVALID = "each watcher_id must be a valid UUID";
export const ERR_WATCHERS_DUPLICATE = "watcher_ids contains duplicate values";
export const ERR_COST_CENTER_INVALID = "cost_center_id must be a valid UUID";
export const ERR_TAG_IDS_TOO_LONG = `tag_ids must have at most ${TAG_IDS_MAX} entries`;
export const ERR_TAG_ID_INVALID = "each tag_id must be a non-empty string";
export const ERR_TAG_IDS_DUPLICATE = "tag_ids contains duplicate values";
export const ERR_INTERNAL_NOTES_TOO_LONG = `internal_notes must be at most ${INTERNAL_NOTES_MAX} characters`;
export const ERR_OPENING_NUMBER_REQUIRED = "opening_number is required";
export const ERR_OPENING_NUMBER_INVALID = "opening_number must be a positive integer";
export const ERR_REJECTION_NOTE_REQUIRED = "rejection_note is required";
export const ERR_REJECTION_NOTE_TOO_LONG = `rejection_note must be at most ${REJECTION_NOTE_MAX} characters`;

function isValidUUID(id: string): boolean {
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	return uuidRegex.test(id);
}

function isValidISO4217(currency: string): boolean {
	return /^[A-Z]{3}$/.test(currency);
}

function validateSalary(salary: Salary | undefined, errs: ValidationError[]): void {
	if (!salary) return;

	if (salary.min_amount === undefined) {
		errs.push(newValidationError("salary.min_amount", ERR_SALARY_MIN_REQUIRED));
	} else if (salary.min_amount <= 0) {
		errs.push(newValidationError("salary.min_amount", ERR_SALARY_MIN_POSITIVE));
	}

	if (salary.max_amount === undefined) {
		errs.push(newValidationError("salary.max_amount", ERR_SALARY_MAX_REQUIRED));
	} else if (salary.min_amount && salary.max_amount < salary.min_amount) {
		errs.push(newValidationError("salary.max_amount", ERR_SALARY_MAX_INVALID));
	}

	if (!salary.currency) {
		errs.push(newValidationError("salary.currency", ERR_SALARY_CURRENCY_REQUIRED));
	} else if (!isValidISO4217(salary.currency)) {
		errs.push(newValidationError("salary.currency", ERR_SALARY_CURRENCY_INVALID));
	}
}

export function validateCreateOpeningRequest(r: CreateOpeningRequest): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!r.title) {
		errs.push(newValidationError("title", ERR_TITLE_REQUIRED));
	} else if (r.title.length > TITLE_MAX) {
		errs.push(newValidationError("title", ERR_TITLE_TOO_LONG));
	}

	if (!r.description) {
		errs.push(newValidationError("description", ERR_DESCRIPTION_REQUIRED));
	} else if (r.description.length > DESCRIPTION_MAX) {
		errs.push(newValidationError("description", ERR_DESCRIPTION_TOO_LONG));
	}

	if (r.is_internal === undefined) {
		errs.push(newValidationError("is_internal", ERR_IS_INTERNAL_REQUIRED));
	}

	if (!r.employment_type) {
		errs.push(newValidationError("employment_type", ERR_EMPLOYMENT_TYPE_REQUIRED));
	} else if (!["full_time", "part_time", "contract", "internship"].includes(r.employment_type)) {
		errs.push(newValidationError("employment_type", ERR_EMPLOYMENT_TYPE_INVALID));
	}

	if (!r.work_location_type) {
		errs.push(newValidationError("work_location_type", ERR_WORK_LOCATION_TYPE_REQUIRED));
	} else if (!["remote", "on_site", "hybrid"].includes(r.work_location_type)) {
		errs.push(newValidationError("work_location_type", ERR_WORK_LOCATION_TYPE_INVALID));
	}

	if (!r.address_ids || r.address_ids.length === 0) {
		errs.push(newValidationError("address_ids", ERR_ADDRESS_IDS_REQUIRED));
	} else {
		if (r.address_ids.length < ADDRESS_IDS_MIN) {
			errs.push(newValidationError("address_ids", ERR_ADDRESS_IDS_TOO_SHORT));
		}
		if (r.address_ids.length > ADDRESS_IDS_MAX) {
			errs.push(newValidationError("address_ids", ERR_ADDRESS_IDS_TOO_LONG));
		}
		for (const id of r.address_ids) {
			if (!isValidUUID(id)) {
				errs.push(newValidationError("address_ids", ERR_ADDRESS_ID_INVALID));
				break;
			}
		}
		if (new Set(r.address_ids).size !== r.address_ids.length) {
			errs.push(newValidationError("address_ids", ERR_ADDRESS_ID_DUPLICATE));
		}
	}

	if (r.min_yoe !== undefined && (r.min_yoe < YOE_MIN || r.min_yoe > YOE_MAX)) {
		errs.push(newValidationError("min_yoe", ERR_MIN_YOE_INVALID));
	}

	if (r.max_yoe !== undefined && (r.max_yoe < YOE_MIN + 1 || r.max_yoe > YOE_MAX)) {
		errs.push(newValidationError("max_yoe", ERR_MAX_YOE_INVALID));
	}

	if (r.min_yoe !== undefined && r.max_yoe !== undefined && r.max_yoe < r.min_yoe) {
		errs.push(newValidationError("max_yoe", ERR_MAX_YOE_LESS_THAN_MIN));
	}

	if (r.min_education_level && !["not_required", "bachelor", "master", "doctorate"].includes(r.min_education_level)) {
		errs.push(newValidationError("min_education_level", ERR_MIN_EDUCATION_LEVEL_INVALID));
	}

	validateSalary(r.salary, errs);

	if (!r.number_of_positions) {
		errs.push(newValidationError("number_of_positions", ERR_NUMBER_OF_POSITIONS_REQUIRED));
	} else if (r.number_of_positions < 1 || r.number_of_positions > POSITIONS_MAX) {
		errs.push(newValidationError("number_of_positions", ERR_NUMBER_OF_POSITIONS_INVALID));
	}

	if (!r.hiring_manager_org_user_id) {
		errs.push(newValidationError("hiring_manager_org_user_id", ERR_HIRING_MANAGER_REQUIRED));
	} else if (!isValidUUID(r.hiring_manager_org_user_id)) {
		errs.push(newValidationError("hiring_manager_org_user_id", ERR_HIRING_MANAGER_INVALID));
	}

	if (!r.recruiter_org_user_id) {
		errs.push(newValidationError("recruiter_org_user_id", ERR_RECRUITER_REQUIRED));
	} else if (!isValidUUID(r.recruiter_org_user_id)) {
		errs.push(newValidationError("recruiter_org_user_id", ERR_RECRUITER_INVALID));
	}

	if (r.hiring_manager_org_user_id && r.recruiter_org_user_id && r.hiring_manager_org_user_id === r.recruiter_org_user_id) {
		errs.push(newValidationError("recruiter_org_user_id", ERR_MANAGER_EQUALS_RECRUITER));
	}

	if (r.hiring_team_member_ids) {
		if (r.hiring_team_member_ids.length > HIRING_TEAM_MAX) {
			errs.push(newValidationError("hiring_team_member_ids", ERR_HIRING_TEAM_TOO_LONG));
		}
		for (const id of r.hiring_team_member_ids) {
			if (!isValidUUID(id)) {
				errs.push(newValidationError("hiring_team_member_ids", ERR_HIRING_TEAM_INVALID));
				break;
			}
		}
		if (new Set(r.hiring_team_member_ids).size !== r.hiring_team_member_ids.length) {
			errs.push(newValidationError("hiring_team_member_ids", ERR_HIRING_TEAM_DUPLICATE));
		}
		if (r.hiring_manager_org_user_id && r.hiring_team_member_ids.includes(r.hiring_manager_org_user_id)) {
			errs.push(newValidationError("hiring_team_member_ids", ERR_HIRING_TEAM_OVERLAPS_MANAGER));
		}
		if (r.recruiter_org_user_id && r.hiring_team_member_ids.includes(r.recruiter_org_user_id)) {
			errs.push(newValidationError("hiring_team_member_ids", ERR_HIRING_TEAM_OVERLAPS_RECRUITER));
		}
	}

	if (r.watcher_ids) {
		if (r.watcher_ids.length > WATCHERS_MAX) {
			errs.push(newValidationError("watcher_ids", ERR_WATCHERS_TOO_LONG));
		}
		for (const id of r.watcher_ids) {
			if (!isValidUUID(id)) {
				errs.push(newValidationError("watcher_ids", ERR_WATCHERS_INVALID));
				break;
			}
		}
		if (new Set(r.watcher_ids).size !== r.watcher_ids.length) {
			errs.push(newValidationError("watcher_ids", ERR_WATCHERS_DUPLICATE));
		}
	}

	if (r.cost_center_id && !isValidUUID(r.cost_center_id)) {
		errs.push(newValidationError("cost_center_id", ERR_COST_CENTER_INVALID));
	}

	if (r.tag_ids) {
		if (r.tag_ids.length > TAG_IDS_MAX) {
			errs.push(newValidationError("tag_ids", ERR_TAG_IDS_TOO_LONG));
		}
		for (const id of r.tag_ids) {
			if (!id || id.trim().length === 0) {
				errs.push(newValidationError("tag_ids", ERR_TAG_ID_INVALID));
				break;
			}
		}
		if (new Set(r.tag_ids).size !== r.tag_ids.length) {
			errs.push(newValidationError("tag_ids", ERR_TAG_IDS_DUPLICATE));
		}
	}

	if (r.internal_notes !== undefined && r.internal_notes.length > INTERNAL_NOTES_MAX) {
		errs.push(newValidationError("internal_notes", ERR_INTERNAL_NOTES_TOO_LONG));
	}

	return errs;
}

export function validateUpdateOpeningRequest(r: UpdateOpeningRequest): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!r.opening_number || r.opening_number <= 0) {
		errs.push(newValidationError("opening_number", ERR_OPENING_NUMBER_INVALID));
	}

	// Validate the same fields as create, except is_internal
	if (!r.title) {
		errs.push(newValidationError("title", ERR_TITLE_REQUIRED));
	} else if (r.title.length > TITLE_MAX) {
		errs.push(newValidationError("title", ERR_TITLE_TOO_LONG));
	}

	if (!r.description) {
		errs.push(newValidationError("description", ERR_DESCRIPTION_REQUIRED));
	} else if (r.description.length > DESCRIPTION_MAX) {
		errs.push(newValidationError("description", ERR_DESCRIPTION_TOO_LONG));
	}

	if (!r.employment_type) {
		errs.push(newValidationError("employment_type", ERR_EMPLOYMENT_TYPE_REQUIRED));
	} else if (!["full_time", "part_time", "contract", "internship"].includes(r.employment_type)) {
		errs.push(newValidationError("employment_type", ERR_EMPLOYMENT_TYPE_INVALID));
	}

	if (!r.work_location_type) {
		errs.push(newValidationError("work_location_type", ERR_WORK_LOCATION_TYPE_REQUIRED));
	} else if (!["remote", "on_site", "hybrid"].includes(r.work_location_type)) {
		errs.push(newValidationError("work_location_type", ERR_WORK_LOCATION_TYPE_INVALID));
	}

	if (!r.address_ids || r.address_ids.length === 0) {
		errs.push(newValidationError("address_ids", ERR_ADDRESS_IDS_REQUIRED));
	} else {
		if (r.address_ids.length < ADDRESS_IDS_MIN) {
			errs.push(newValidationError("address_ids", ERR_ADDRESS_IDS_TOO_SHORT));
		}
		if (r.address_ids.length > ADDRESS_IDS_MAX) {
			errs.push(newValidationError("address_ids", ERR_ADDRESS_IDS_TOO_LONG));
		}
		for (const id of r.address_ids) {
			if (!isValidUUID(id)) {
				errs.push(newValidationError("address_ids", ERR_ADDRESS_ID_INVALID));
				break;
			}
		}
		if (new Set(r.address_ids).size !== r.address_ids.length) {
			errs.push(newValidationError("address_ids", ERR_ADDRESS_ID_DUPLICATE));
		}
	}

	if (r.min_yoe !== undefined && (r.min_yoe < YOE_MIN || r.min_yoe > YOE_MAX)) {
		errs.push(newValidationError("min_yoe", ERR_MIN_YOE_INVALID));
	}

	if (r.max_yoe !== undefined && (r.max_yoe < YOE_MIN + 1 || r.max_yoe > YOE_MAX)) {
		errs.push(newValidationError("max_yoe", ERR_MAX_YOE_INVALID));
	}

	if (r.min_yoe !== undefined && r.max_yoe !== undefined && r.max_yoe < r.min_yoe) {
		errs.push(newValidationError("max_yoe", ERR_MAX_YOE_LESS_THAN_MIN));
	}

	if (r.min_education_level && !["not_required", "bachelor", "master", "doctorate"].includes(r.min_education_level)) {
		errs.push(newValidationError("min_education_level", ERR_MIN_EDUCATION_LEVEL_INVALID));
	}

	validateSalary(r.salary, errs);

	if (!r.number_of_positions) {
		errs.push(newValidationError("number_of_positions", ERR_NUMBER_OF_POSITIONS_REQUIRED));
	} else if (r.number_of_positions < 1 || r.number_of_positions > POSITIONS_MAX) {
		errs.push(newValidationError("number_of_positions", ERR_NUMBER_OF_POSITIONS_INVALID));
	}

	if (!r.hiring_manager_org_user_id) {
		errs.push(newValidationError("hiring_manager_org_user_id", ERR_HIRING_MANAGER_REQUIRED));
	} else if (!isValidUUID(r.hiring_manager_org_user_id)) {
		errs.push(newValidationError("hiring_manager_org_user_id", ERR_HIRING_MANAGER_INVALID));
	}

	if (!r.recruiter_org_user_id) {
		errs.push(newValidationError("recruiter_org_user_id", ERR_RECRUITER_REQUIRED));
	} else if (!isValidUUID(r.recruiter_org_user_id)) {
		errs.push(newValidationError("recruiter_org_user_id", ERR_RECRUITER_INVALID));
	}

	if (r.hiring_manager_org_user_id && r.recruiter_org_user_id && r.hiring_manager_org_user_id === r.recruiter_org_user_id) {
		errs.push(newValidationError("recruiter_org_user_id", ERR_MANAGER_EQUALS_RECRUITER));
	}

	if (r.hiring_team_member_ids) {
		if (r.hiring_team_member_ids.length > HIRING_TEAM_MAX) {
			errs.push(newValidationError("hiring_team_member_ids", ERR_HIRING_TEAM_TOO_LONG));
		}
		for (const id of r.hiring_team_member_ids) {
			if (!isValidUUID(id)) {
				errs.push(newValidationError("hiring_team_member_ids", ERR_HIRING_TEAM_INVALID));
				break;
			}
		}
		if (new Set(r.hiring_team_member_ids).size !== r.hiring_team_member_ids.length) {
			errs.push(newValidationError("hiring_team_member_ids", ERR_HIRING_TEAM_DUPLICATE));
		}
		if (r.hiring_manager_org_user_id && r.hiring_team_member_ids.includes(r.hiring_manager_org_user_id)) {
			errs.push(newValidationError("hiring_team_member_ids", ERR_HIRING_TEAM_OVERLAPS_MANAGER));
		}
		if (r.recruiter_org_user_id && r.hiring_team_member_ids.includes(r.recruiter_org_user_id)) {
			errs.push(newValidationError("hiring_team_member_ids", ERR_HIRING_TEAM_OVERLAPS_RECRUITER));
		}
	}

	if (r.watcher_ids) {
		if (r.watcher_ids.length > WATCHERS_MAX) {
			errs.push(newValidationError("watcher_ids", ERR_WATCHERS_TOO_LONG));
		}
		for (const id of r.watcher_ids) {
			if (!isValidUUID(id)) {
				errs.push(newValidationError("watcher_ids", ERR_WATCHERS_INVALID));
				break;
			}
		}
		if (new Set(r.watcher_ids).size !== r.watcher_ids.length) {
			errs.push(newValidationError("watcher_ids", ERR_WATCHERS_DUPLICATE));
		}
	}

	if (r.cost_center_id && !isValidUUID(r.cost_center_id)) {
		errs.push(newValidationError("cost_center_id", ERR_COST_CENTER_INVALID));
	}

	if (r.tag_ids) {
		if (r.tag_ids.length > TAG_IDS_MAX) {
			errs.push(newValidationError("tag_ids", ERR_TAG_IDS_TOO_LONG));
		}
		for (const id of r.tag_ids) {
			if (!id || id.trim().length === 0) {
				errs.push(newValidationError("tag_ids", ERR_TAG_ID_INVALID));
				break;
			}
		}
		if (new Set(r.tag_ids).size !== r.tag_ids.length) {
			errs.push(newValidationError("tag_ids", ERR_TAG_IDS_DUPLICATE));
		}
	}

	if (r.internal_notes !== undefined && r.internal_notes.length > INTERNAL_NOTES_MAX) {
		errs.push(newValidationError("internal_notes", ERR_INTERNAL_NOTES_TOO_LONG));
	}

	return errs;
}

export function validateRejectOpeningRequest(r: RejectOpeningRequest): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!r.opening_number || r.opening_number <= 0) {
		errs.push(newValidationError("opening_number", ERR_OPENING_NUMBER_INVALID));
	}

	if (!r.rejection_note) {
		errs.push(newValidationError("rejection_note", ERR_REJECTION_NOTE_REQUIRED));
	} else if (r.rejection_note.length > REJECTION_NOTE_MAX) {
		errs.push(newValidationError("rejection_note", ERR_REJECTION_NOTE_TOO_LONG));
	}

	return errs;
}

// Import types from other specs
export { type OrgAddress } from "./company-addresses";
export { type CostCenter } from "./cost-centers";

// OrgUserShort and OrgTag are not exported from their respective modules; defined inline.
export interface OrgUserShort {
	org_user_id: string;
	email_address: string;
	full_name?: string;
	handle?: string;
}

export interface OrgTag {
	tag_id: string;
	display_name: string;
}
