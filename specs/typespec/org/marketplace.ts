import { type ValidationError, newValidationError } from "../common/common";

export type OrgCapabilityStatus =
	| "pending_approval"
	| "active"
	| "rejected"
	| "expired"
	| "revoked";

export type ServiceListingState =
	| "draft"
	| "pending_review"
	| "active"
	| "paused"
	| "rejected"
	| "suspended"
	| "appealing"
	| "archived";

export type ServiceCategory = "talent_sourcing";

export type CompanySize = "startup" | "smb" | "enterprise";

export type SeniorityLevel =
	| "intern"
	| "junior"
	| "mid"
	| "senior"
	| "lead"
	| "director"
	| "c_suite";

export type Industry =
	| "technology_software"
	| "finance_banking"
	| "healthcare_life_sciences"
	| "manufacturing_engineering"
	| "retail_consumer_goods"
	| "media_entertainment"
	| "education_training"
	| "legal_services"
	| "consulting_professional_services"
	| "real_estate_construction"
	| "energy_utilities"
	| "logistics_supply_chain"
	| "government_public_sector"
	| "nonprofit_ngo"
	| "other";

export type JobFunction =
	| "engineering_technology"
	| "sales_business_development"
	| "marketing"
	| "finance_accounting"
	| "human_resources"
	| "operations_supply_chain"
	| "product_management"
	| "design_creative"
	| "legal_compliance"
	| "customer_success_support"
	| "data_analytics"
	| "executive_general_management";

export type ReportReason =
	| "misleading_information"
	| "fraudulent"
	| "inappropriate_content"
	| "spam"
	| "other";

// ---- Response types ----

export interface OrgCapability {
	org_id: string;
	capability: string;
	status: OrgCapabilityStatus;
	application_note?: string;
	applied_at?: string;
	admin_note?: string;
	subscription_price?: string;
	currency?: string;
	granted_at?: string;
	expires_at?: string;
	created_at: string;
}

export interface ServiceListingSummary {
	service_listing_id: string;
	home_region: string;
	org_id: string;
	name: string;
	short_blurb: string;
	logo_url?: string;
	org_name: string;
	service_category: ServiceCategory;
	countries_of_service: string[];
	created_at: string;
}

export interface ServiceListing {
	service_listing_id: string;
	org_id: string;
	name: string;
	short_blurb: string;
	description: string;
	service_category: ServiceCategory;
	countries_of_service: string[];
	contact_url: string;
	pricing_info?: string;
	state: ServiceListingState;
	appeal_exhausted: boolean;
	last_activated_at?: string;
	industries_served: string[];
	industries_served_other?: string;
	company_sizes_served: string[];
	job_functions_sourced: string[];
	seniority_levels_sourced: string[];
	geographic_sourcing_regions: string[];
	last_review_admin_note?: string;
	appeal_reason?: string;
	appeal_admin_note?: string;
	created_at: string;
	updated_at: string;
}

// ---- Capability requests ----

export interface ApplyMarketplaceProviderCapabilityRequest {
	application_note?: string;
}

export function validateApplyMarketplaceProviderCapabilityRequest(
	req: ApplyMarketplaceProviderCapabilityRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (req.application_note && req.application_note.length > 1000) {
		errs.push(
			newValidationError(
				"application_note",
				"application_note must be at most 1000 characters"
			)
		);
	}
	return errs;
}

export interface GetMarketplaceProviderCapabilityRequest {}

// ---- ServiceListing fields shared ----

export interface ServiceListingFields {
	name: string;
	short_blurb: string;
	description: string;
	service_category: ServiceCategory;
	countries_of_service: string[];
	contact_url: string;
	pricing_info?: string;
	industries_served: Industry[];
	industries_served_other?: string;
	company_sizes_served: CompanySize[];
	job_functions_sourced: JobFunction[];
	seniority_levels_sourced: SeniorityLevel[];
	geographic_sourcing_regions: string[];
}

function validateServiceListingFields(
	fields: ServiceListingFields
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!fields.name) {
		errs.push(newValidationError("name", "name is required"));
	} else if (fields.name.length > 100) {
		errs.push(
			newValidationError("name", "name must be at most 100 characters")
		);
	}

	if (!fields.short_blurb) {
		errs.push(newValidationError("short_blurb", "short_blurb is required"));
	} else if (fields.short_blurb.length > 250) {
		errs.push(
			newValidationError(
				"short_blurb",
				"short_blurb must be at most 250 characters"
			)
		);
	}

	if (!fields.description) {
		errs.push(newValidationError("description", "description is required"));
	} else if (fields.description.length > 5000) {
		errs.push(
			newValidationError(
				"description",
				"description must be at most 5000 characters"
			)
		);
	}

	if (!fields.contact_url) {
		errs.push(newValidationError("contact_url", "contact_url is required"));
	} else if (!fields.contact_url.startsWith("https://")) {
		errs.push(
			newValidationError("contact_url", "contact_url must start with https://")
		);
	}

	if (fields.pricing_info && fields.pricing_info.length > 500) {
		errs.push(
			newValidationError(
				"pricing_info",
				"pricing_info must be at most 500 characters"
			)
		);
	}

	if (fields.service_category !== "talent_sourcing") {
		errs.push(
			newValidationError(
				"service_category",
				"service_category must be 'talent_sourcing'"
			)
		);
	}

	if (
		!fields.countries_of_service ||
		fields.countries_of_service.length === 0
	) {
		errs.push(
			newValidationError(
				"countries_of_service",
				"at least one country of service is required"
			)
		);
	}

	if (!fields.industries_served || fields.industries_served.length === 0) {
		errs.push(
			newValidationError(
				"industries_served",
				"at least one industry is required"
			)
		);
	} else if (fields.industries_served.includes("other")) {
		if (!fields.industries_served_other) {
			errs.push(
				newValidationError(
					"industries_served_other",
					"industries_served_other is required when 'other' is selected"
				)
			);
		} else if (fields.industries_served_other.length > 100) {
			errs.push(
				newValidationError(
					"industries_served_other",
					"industries_served_other must be at most 100 characters"
				)
			);
		}
	}

	if (
		!fields.company_sizes_served ||
		fields.company_sizes_served.length === 0
	) {
		errs.push(
			newValidationError(
				"company_sizes_served",
				"at least one company size is required"
			)
		);
	}

	if (
		!fields.job_functions_sourced ||
		fields.job_functions_sourced.length === 0
	) {
		errs.push(
			newValidationError(
				"job_functions_sourced",
				"at least one job function is required"
			)
		);
	}

	if (
		!fields.seniority_levels_sourced ||
		fields.seniority_levels_sourced.length === 0
	) {
		errs.push(
			newValidationError(
				"seniority_levels_sourced",
				"at least one seniority level is required"
			)
		);
	}

	if (
		!fields.geographic_sourcing_regions ||
		fields.geographic_sourcing_regions.length === 0
	) {
		errs.push(
			newValidationError(
				"geographic_sourcing_regions",
				"at least one geographic sourcing region is required"
			)
		);
	}

	return errs;
}

// ---- Create / Update ----

export interface CreateMarketplaceServiceListingRequest extends ServiceListingFields {}

export function validateCreateMarketplaceServiceListingRequest(
	req: CreateMarketplaceServiceListingRequest
): ValidationError[] {
	return validateServiceListingFields(req);
}

export interface CreateMarketplaceServiceListingResponse {
	service_listing_id: string;
}

export interface UpdateMarketplaceServiceListingRequest extends ServiceListingFields {
	service_listing_id: string;
}

export function validateUpdateMarketplaceServiceListingRequest(
	req: UpdateMarketplaceServiceListingRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.service_listing_id) {
		errs.push(
			newValidationError("service_listing_id", "service_listing_id is required")
		);
	}
	errs.push(...validateServiceListingFields(req));
	return errs;
}

export interface SubmitMarketplaceServiceListingRequest {
	service_listing_id: string;
}

export interface PauseMarketplaceServiceListingRequest {
	service_listing_id: string;
}

export interface UnpauseMarketplaceServiceListingRequest {
	service_listing_id: string;
}

export interface ArchiveMarketplaceServiceListingRequest {
	service_listing_id: string;
}

export interface SubmitMarketplaceServiceListingAppealRequest {
	service_listing_id: string;
	appeal_reason: string;
}

export function validateSubmitMarketplaceServiceListingAppealRequest(
	req: SubmitMarketplaceServiceListingAppealRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.service_listing_id) {
		errs.push(
			newValidationError("service_listing_id", "service_listing_id is required")
		);
	}
	if (!req.appeal_reason) {
		errs.push(newValidationError("appeal_reason", "appeal_reason is required"));
	} else if (req.appeal_reason.length > 2000) {
		errs.push(
			newValidationError(
				"appeal_reason",
				"appeal_reason must be at most 2000 characters"
			)
		);
	}
	return errs;
}

export interface ListMarketplaceServiceListingsRequest {
	filter_state?: ServiceListingState;
	cursor?: string;
	limit?: number;
}

export interface ListMarketplaceServiceListingsResponse {
	service_listings: ServiceListing[];
	next_cursor?: string;
}

export interface GetMarketplaceServiceListingRequest {
	service_listing_id: string;
}

// ---- Browse (buyer) ----

export interface BrowseMarketplaceServiceListingsRequest {
	keyword?: string;
	service_category?: ServiceCategory;
	industries?: Industry[];
	company_sizes?: CompanySize[];
	job_functions?: JobFunction[];
	seniority_levels?: SeniorityLevel[];
	countries_of_service?: string[];
	geographic_sourcing_regions?: string[];
	cursor?: string;
	limit?: number;
}

export interface BrowseMarketplaceServiceListingsResponse {
	service_listings: ServiceListingSummary[];
	next_cursor?: string;
}

export interface GetPublicMarketplaceServiceListingRequest {
	service_listing_id: string;
	home_region: string;
}

export interface ReportMarketplaceServiceListingRequest {
	service_listing_id: string;
	home_region: string;
	reason: ReportReason;
	reason_other?: string;
}

export function validateReportMarketplaceServiceListingRequest(
	req: ReportMarketplaceServiceListingRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!req.service_listing_id) {
		errs.push(
			newValidationError("service_listing_id", "service_listing_id is required")
		);
	}
	if (!req.home_region) {
		errs.push(newValidationError("home_region", "home_region is required"));
	}
	const validReasons: ReportReason[] = [
		"misleading_information",
		"fraudulent",
		"inappropriate_content",
		"spam",
		"other",
	];
	if (!validReasons.includes(req.reason)) {
		errs.push(
			newValidationError("reason", "reason must be a valid report reason")
		);
	} else if (req.reason === "other") {
		if (!req.reason_other) {
			errs.push(
				newValidationError(
					"reason_other",
					"reason_other is required when reason is 'other'"
				)
			);
		} else if (req.reason_other.length > 500) {
			errs.push(
				newValidationError(
					"reason_other",
					"reason_other must be at most 500 characters"
				)
			);
		}
	}
	return errs;
}
