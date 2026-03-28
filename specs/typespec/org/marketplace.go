package org

import (
	"fmt"
	"net/url"
	"strings"

	"vetchium-api-server.typespec/common"
)

// ---- Enums ----

type OrgCapabilityStatus string

const (
	OrgCapabilityStatusPendingApproval OrgCapabilityStatus = "pending_approval"
	OrgCapabilityStatusActive          OrgCapabilityStatus = "active"
	OrgCapabilityStatusRejected        OrgCapabilityStatus = "rejected"
	OrgCapabilityStatusExpired         OrgCapabilityStatus = "expired"
	OrgCapabilityStatusRevoked         OrgCapabilityStatus = "revoked"
)

type ServiceListingState string

const (
	ServiceListingStateDraft         ServiceListingState = "draft"
	ServiceListingStatePendingReview ServiceListingState = "pending_review"
	ServiceListingStateActive        ServiceListingState = "active"
	ServiceListingStatePaused        ServiceListingState = "paused"
	ServiceListingStateRejected      ServiceListingState = "rejected"
	ServiceListingStateSuspended     ServiceListingState = "suspended"
	ServiceListingStateAppealing     ServiceListingState = "appealing"
	ServiceListingStateArchived      ServiceListingState = "archived"
)

type ServiceCategory string

const (
	ServiceCategoryTalentSourcing ServiceCategory = "talent_sourcing"
)

type CompanySize string

const (
	CompanySizeStartup    CompanySize = "startup"
	CompanySizeSMB        CompanySize = "smb"
	CompanySizeEnterprise CompanySize = "enterprise"
)

type SeniorityLevel string

const (
	SeniorityLevelIntern   SeniorityLevel = "intern"
	SeniorityLevelJunior   SeniorityLevel = "junior"
	SeniorityLevelMid      SeniorityLevel = "mid"
	SeniorityLevelSenior   SeniorityLevel = "senior"
	SeniorityLevelLead     SeniorityLevel = "lead"
	SeniorityLevelDirector SeniorityLevel = "director"
	SeniorityLevelCSuite   SeniorityLevel = "c_suite"
)

type Industry string

const (
	IndustryTechnologySoftware             Industry = "technology_software"
	IndustryFinanceBanking                 Industry = "finance_banking"
	IndustryHealthcareLifeSciences         Industry = "healthcare_life_sciences"
	IndustryManufacturingEngineering       Industry = "manufacturing_engineering"
	IndustryRetailConsumerGoods            Industry = "retail_consumer_goods"
	IndustryMediaEntertainment             Industry = "media_entertainment"
	IndustryEducationTraining              Industry = "education_training"
	IndustryLegalServices                  Industry = "legal_services"
	IndustryConsultingProfessionalServices Industry = "consulting_professional_services"
	IndustryRealEstateConstruction         Industry = "real_estate_construction"
	IndustryEnergyUtilities                Industry = "energy_utilities"
	IndustryLogisticsSupplyChain           Industry = "logistics_supply_chain"
	IndustryGovernmentPublicSector         Industry = "government_public_sector"
	IndustryNonprofitNGO                   Industry = "nonprofit_ngo"
	IndustryOther                          Industry = "other"
)

type JobFunction string

const (
	JobFunctionEngineeringTechnology      JobFunction = "engineering_technology"
	JobFunctionSalesBusinessDevelopment   JobFunction = "sales_business_development"
	JobFunctionMarketing                  JobFunction = "marketing"
	JobFunctionFinanceAccounting          JobFunction = "finance_accounting"
	JobFunctionHumanResources             JobFunction = "human_resources"
	JobFunctionOperationsSupplyChain      JobFunction = "operations_supply_chain"
	JobFunctionProductManagement          JobFunction = "product_management"
	JobFunctionDesignCreative             JobFunction = "design_creative"
	JobFunctionLegalCompliance            JobFunction = "legal_compliance"
	JobFunctionCustomerSuccessSupport     JobFunction = "customer_success_support"
	JobFunctionDataAnalytics              JobFunction = "data_analytics"
	JobFunctionExecutiveGeneralManagement JobFunction = "executive_general_management"
)

type ReportReason string

const (
	ReportReasonMisleadingInformation ReportReason = "misleading_information"
	ReportReasonFraudulent            ReportReason = "fraudulent"
	ReportReasonInappropriateContent  ReportReason = "inappropriate_content"
	ReportReasonSpam                  ReportReason = "spam"
	ReportReasonOther                 ReportReason = "other"
)

// ---- Validation helpers ----

var validIndustries = map[Industry]bool{
	IndustryTechnologySoftware: true, IndustryFinanceBanking: true,
	IndustryHealthcareLifeSciences: true, IndustryManufacturingEngineering: true,
	IndustryRetailConsumerGoods: true, IndustryMediaEntertainment: true,
	IndustryEducationTraining: true, IndustryLegalServices: true,
	IndustryConsultingProfessionalServices: true, IndustryRealEstateConstruction: true,
	IndustryEnergyUtilities: true, IndustryLogisticsSupplyChain: true,
	IndustryGovernmentPublicSector: true, IndustryNonprofitNGO: true,
	IndustryOther: true,
}

var validJobFunctions = map[JobFunction]bool{
	JobFunctionEngineeringTechnology: true, JobFunctionSalesBusinessDevelopment: true,
	JobFunctionMarketing: true, JobFunctionFinanceAccounting: true,
	JobFunctionHumanResources: true, JobFunctionOperationsSupplyChain: true,
	JobFunctionProductManagement: true, JobFunctionDesignCreative: true,
	JobFunctionLegalCompliance: true, JobFunctionCustomerSuccessSupport: true,
	JobFunctionDataAnalytics: true, JobFunctionExecutiveGeneralManagement: true,
}

var validSeniorityLevels = map[SeniorityLevel]bool{
	SeniorityLevelIntern: true, SeniorityLevelJunior: true, SeniorityLevelMid: true,
	SeniorityLevelSenior: true, SeniorityLevelLead: true, SeniorityLevelDirector: true,
	SeniorityLevelCSuite: true,
}

var validCompanySizes = map[CompanySize]bool{
	CompanySizeStartup: true, CompanySizeSMB: true, CompanySizeEnterprise: true,
}

var validReportReasons = map[ReportReason]bool{
	ReportReasonMisleadingInformation: true, ReportReasonFraudulent: true,
	ReportReasonInappropriateContent: true, ReportReasonSpam: true,
	ReportReasonOther: true,
}

const (
	maxServiceListingName        = 100
	maxServiceListingBlurb       = 250
	maxServiceListingDescription = 5000
	maxPricingInfo               = 500
	maxIndustriesOther           = 100
	maxApplicationNote           = 1000
	maxAppealReason              = 2000
	maxReportOther               = 500
)

func validateContactURL(u string) error {
	if u == "" {
		return fmt.Errorf("contact_url is required")
	}
	if !strings.HasPrefix(u, "https://") {
		return fmt.Errorf("contact_url must start with https://")
	}
	if _, err := url.ParseRequestURI(u); err != nil {
		return fmt.Errorf("contact_url must be a valid URL")
	}
	return nil
}

func validateServiceListingFields(
	name, shortBlurb, description, contactURL string,
	pricingInfo *string,
	serviceCategory ServiceCategory,
	countriesOfService []string,
	industriesServed []Industry,
	industriesServedOther *string,
	companySizesServed []CompanySize,
	jobFunctionsSourced []JobFunction,
	seniorityLevelsSourced []SeniorityLevel,
	geographicSourcingRegions []string,
) []common.ValidationError {
	var errs []common.ValidationError

	if name == "" {
		errs = append(errs, common.NewValidationError("name", fmt.Errorf("name is required")))
	} else if len(name) > maxServiceListingName {
		errs = append(errs, common.NewValidationError("name", fmt.Errorf("name must be at most %d characters", maxServiceListingName)))
	}

	if shortBlurb == "" {
		errs = append(errs, common.NewValidationError("short_blurb", fmt.Errorf("short_blurb is required")))
	} else if len(shortBlurb) > maxServiceListingBlurb {
		errs = append(errs, common.NewValidationError("short_blurb", fmt.Errorf("short_blurb must be at most %d characters", maxServiceListingBlurb)))
	}

	if description == "" {
		errs = append(errs, common.NewValidationError("description", fmt.Errorf("description is required")))
	} else if len(description) > maxServiceListingDescription {
		errs = append(errs, common.NewValidationError("description", fmt.Errorf("description must be at most %d characters", maxServiceListingDescription)))
	}

	if err := validateContactURL(contactURL); err != nil {
		errs = append(errs, common.NewValidationError("contact_url", err))
	}

	if pricingInfo != nil && len(*pricingInfo) > maxPricingInfo {
		errs = append(errs, common.NewValidationError("pricing_info", fmt.Errorf("pricing_info must be at most %d characters", maxPricingInfo)))
	}

	if serviceCategory != ServiceCategoryTalentSourcing {
		errs = append(errs, common.NewValidationError("service_category", fmt.Errorf("service_category must be 'talent_sourcing'")))
	}

	if len(countriesOfService) == 0 {
		errs = append(errs, common.NewValidationError("countries_of_service", fmt.Errorf("at least one country of service is required")))
	}

	// Talent sourcing specific
	if len(industriesServed) == 0 {
		errs = append(errs, common.NewValidationError("industries_served", fmt.Errorf("at least one industry is required")))
	} else {
		hasOther := false
		for _, ind := range industriesServed {
			if !validIndustries[ind] {
				errs = append(errs, common.NewValidationError("industries_served", fmt.Errorf("invalid industry: %s", ind)))
				break
			}
			if ind == IndustryOther {
				hasOther = true
			}
		}
		if hasOther {
			if industriesServedOther == nil || *industriesServedOther == "" {
				errs = append(errs, common.NewValidationError("industries_served_other", fmt.Errorf("industries_served_other is required when 'other' is selected")))
			} else if len(*industriesServedOther) > maxIndustriesOther {
				errs = append(errs, common.NewValidationError("industries_served_other", fmt.Errorf("industries_served_other must be at most %d characters", maxIndustriesOther)))
			}
		}
	}

	if len(companySizesServed) == 0 {
		errs = append(errs, common.NewValidationError("company_sizes_served", fmt.Errorf("at least one company size is required")))
	} else {
		for _, cs := range companySizesServed {
			if !validCompanySizes[cs] {
				errs = append(errs, common.NewValidationError("company_sizes_served", fmt.Errorf("invalid company size: %s", cs)))
				break
			}
		}
	}

	if len(jobFunctionsSourced) == 0 {
		errs = append(errs, common.NewValidationError("job_functions_sourced", fmt.Errorf("at least one job function is required")))
	} else {
		for _, jf := range jobFunctionsSourced {
			if !validJobFunctions[jf] {
				errs = append(errs, common.NewValidationError("job_functions_sourced", fmt.Errorf("invalid job function: %s", jf)))
				break
			}
		}
	}

	if len(seniorityLevelsSourced) == 0 {
		errs = append(errs, common.NewValidationError("seniority_levels_sourced", fmt.Errorf("at least one seniority level is required")))
	} else {
		for _, sl := range seniorityLevelsSourced {
			if !validSeniorityLevels[sl] {
				errs = append(errs, common.NewValidationError("seniority_levels_sourced", fmt.Errorf("invalid seniority level: %s", sl)))
				break
			}
		}
	}

	if len(geographicSourcingRegions) == 0 {
		errs = append(errs, common.NewValidationError("geographic_sourcing_regions", fmt.Errorf("at least one geographic sourcing region is required")))
	}

	return errs
}

// ---- Response types ----

type OrgCapability struct {
	OrgID             string              `json:"org_id"`
	Capability        string              `json:"capability"`
	Status            OrgCapabilityStatus `json:"status"`
	ApplicationNote   *string             `json:"application_note,omitempty"`
	AppliedAt         *string             `json:"applied_at,omitempty"`
	AdminNote         *string             `json:"admin_note,omitempty"`
	SubscriptionPrice *string             `json:"subscription_price,omitempty"`
	Currency          *string             `json:"currency,omitempty"`
	GrantedAt         *string             `json:"granted_at,omitempty"`
	ExpiresAt         *string             `json:"expires_at,omitempty"`
	CreatedAt         string              `json:"created_at"`
}

type ServiceListingSummary struct {
	ServiceListingID   string          `json:"service_listing_id"`
	HomeRegion         string          `json:"home_region"`
	OrgID              string          `json:"org_id"`
	Name               string          `json:"name"`
	ShortBlurb         string          `json:"short_blurb"`
	LogoURL            *string         `json:"logo_url,omitempty"`
	OrgName            string          `json:"org_name"`
	ServiceCategory    ServiceCategory `json:"service_category"`
	CountriesOfService []string        `json:"countries_of_service"`
	CreatedAt          string          `json:"created_at"`
}

type ServiceListing struct {
	ServiceListingID          string              `json:"service_listing_id"`
	OrgID                     string              `json:"org_id"`
	Name                      string              `json:"name"`
	ShortBlurb                string              `json:"short_blurb"`
	Description               string              `json:"description"`
	ServiceCategory           ServiceCategory     `json:"service_category"`
	CountriesOfService        []string            `json:"countries_of_service"`
	ContactURL                string              `json:"contact_url"`
	PricingInfo               *string             `json:"pricing_info,omitempty"`
	State                     ServiceListingState `json:"state"`
	AppealExhausted           bool                `json:"appeal_exhausted"`
	LastActivatedAt           *string             `json:"last_activated_at,omitempty"`
	IndustriesServed          []string            `json:"industries_served"`
	IndustriesServedOther     *string             `json:"industries_served_other,omitempty"`
	CompanySizesServed        []string            `json:"company_sizes_served"`
	JobFunctionsSourced       []string            `json:"job_functions_sourced"`
	SeniorityLevelsSourced    []string            `json:"seniority_levels_sourced"`
	GeographicSourcingRegions []string            `json:"geographic_sourcing_regions"`
	LastReviewAdminNote       *string             `json:"last_review_admin_note,omitempty"`
	AppealReason              *string             `json:"appeal_reason,omitempty"`
	AppealAdminNote           *string             `json:"appeal_admin_note,omitempty"`
	CreatedAt                 string              `json:"created_at"`
	UpdatedAt                 string              `json:"updated_at"`
}

// ---- Capability endpoints ----

type ApplyMarketplaceProviderCapabilityRequest struct {
	ApplicationNote *string `json:"application_note,omitempty"`
}

func (r ApplyMarketplaceProviderCapabilityRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ApplicationNote != nil && len(*r.ApplicationNote) > maxApplicationNote {
		errs = append(errs, common.NewValidationError("application_note", fmt.Errorf("application_note must be at most %d characters", maxApplicationNote)))
	}
	return errs
}

type GetMarketplaceProviderCapabilityRequest struct{}

func (r GetMarketplaceProviderCapabilityRequest) Validate() []common.ValidationError {
	return nil
}

// ---- ServiceListing create/update request ----

type ServiceListingRequest struct {
	Name                      string           `json:"name"`
	ShortBlurb                string           `json:"short_blurb"`
	Description               string           `json:"description"`
	ServiceCategory           ServiceCategory  `json:"service_category"`
	CountriesOfService        []string         `json:"countries_of_service"`
	ContactURL                string           `json:"contact_url"`
	PricingInfo               *string          `json:"pricing_info,omitempty"`
	IndustriesServed          []Industry       `json:"industries_served"`
	IndustriesServedOther     *string          `json:"industries_served_other,omitempty"`
	CompanySizesServed        []CompanySize    `json:"company_sizes_served"`
	JobFunctionsSourced       []JobFunction    `json:"job_functions_sourced"`
	SeniorityLevelsSourced    []SeniorityLevel `json:"seniority_levels_sourced"`
	GeographicSourcingRegions []string         `json:"geographic_sourcing_regions"`
}

func (r ServiceListingRequest) validate() []common.ValidationError {
	return validateServiceListingFields(
		r.Name, r.ShortBlurb, r.Description, r.ContactURL, r.PricingInfo,
		r.ServiceCategory, r.CountriesOfService,
		r.IndustriesServed, r.IndustriesServedOther,
		r.CompanySizesServed, r.JobFunctionsSourced,
		r.SeniorityLevelsSourced, r.GeographicSourcingRegions,
	)
}

type CreateMarketplaceServiceListingRequest struct {
	ServiceListingRequest
}

func (r CreateMarketplaceServiceListingRequest) Validate() []common.ValidationError {
	return r.ServiceListingRequest.validate()
}

type CreateMarketplaceServiceListingResponse struct {
	ServiceListingID string `json:"service_listing_id"`
}

type UpdateMarketplaceServiceListingRequest struct {
	ServiceListingID string `json:"service_listing_id"`
	ServiceListingRequest
}

func (r UpdateMarketplaceServiceListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ServiceListingID == "" {
		errs = append(errs, common.NewValidationError("service_listing_id", fmt.Errorf("service_listing_id is required")))
	}
	errs = append(errs, r.ServiceListingRequest.validate()...)
	return errs
}

type SubmitMarketplaceServiceListingRequest struct {
	ServiceListingID string `json:"service_listing_id"`
}

func (r SubmitMarketplaceServiceListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ServiceListingID == "" {
		errs = append(errs, common.NewValidationError("service_listing_id", fmt.Errorf("service_listing_id is required")))
	}
	return errs
}

type PauseMarketplaceServiceListingRequest struct {
	ServiceListingID string `json:"service_listing_id"`
}

func (r PauseMarketplaceServiceListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ServiceListingID == "" {
		errs = append(errs, common.NewValidationError("service_listing_id", fmt.Errorf("service_listing_id is required")))
	}
	return errs
}

type UnpauseMarketplaceServiceListingRequest struct {
	ServiceListingID string `json:"service_listing_id"`
}

func (r UnpauseMarketplaceServiceListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ServiceListingID == "" {
		errs = append(errs, common.NewValidationError("service_listing_id", fmt.Errorf("service_listing_id is required")))
	}
	return errs
}

type ArchiveMarketplaceServiceListingRequest struct {
	ServiceListingID string `json:"service_listing_id"`
}

func (r ArchiveMarketplaceServiceListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ServiceListingID == "" {
		errs = append(errs, common.NewValidationError("service_listing_id", fmt.Errorf("service_listing_id is required")))
	}
	return errs
}

type SubmitMarketplaceServiceListingAppealRequest struct {
	ServiceListingID string `json:"service_listing_id"`
	AppealReason     string `json:"appeal_reason"`
}

func (r SubmitMarketplaceServiceListingAppealRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ServiceListingID == "" {
		errs = append(errs, common.NewValidationError("service_listing_id", fmt.Errorf("service_listing_id is required")))
	}
	if r.AppealReason == "" {
		errs = append(errs, common.NewValidationError("appeal_reason", fmt.Errorf("appeal_reason is required")))
	} else if len(r.AppealReason) > maxAppealReason {
		errs = append(errs, common.NewValidationError("appeal_reason", fmt.Errorf("appeal_reason must be at most %d characters", maxAppealReason)))
	}
	return errs
}

type ListMarketplaceServiceListingsRequest struct {
	FilterState *ServiceListingState `json:"filter_state,omitempty"`
	Cursor      *string              `json:"cursor,omitempty"`
	Limit       *int                 `json:"limit,omitempty"`
}

func (r ListMarketplaceServiceListingsRequest) Validate() []common.ValidationError {
	return nil
}

type ListMarketplaceServiceListingsResponse struct {
	ServiceListings []ServiceListing `json:"service_listings"`
	NextCursor      *string          `json:"next_cursor,omitempty"`
}

type GetMarketplaceServiceListingRequest struct {
	ServiceListingID string `json:"service_listing_id"`
}

func (r GetMarketplaceServiceListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ServiceListingID == "" {
		errs = append(errs, common.NewValidationError("service_listing_id", fmt.Errorf("service_listing_id is required")))
	}
	return errs
}

// ---- Browse (buyer) endpoints ----

type BrowseMarketplaceServiceListingsRequest struct {
	Keyword                   *string          `json:"keyword,omitempty"`
	ServiceCategory           *ServiceCategory `json:"service_category,omitempty"`
	Industries                []Industry       `json:"industries,omitempty"`
	CompanySizes              []CompanySize    `json:"company_sizes,omitempty"`
	JobFunctions              []JobFunction    `json:"job_functions,omitempty"`
	SeniorityLevels           []SeniorityLevel `json:"seniority_levels,omitempty"`
	CountriesOfService        []string         `json:"countries_of_service,omitempty"`
	GeographicSourcingRegions []string         `json:"geographic_sourcing_regions,omitempty"`
	Cursor                    *string          `json:"cursor,omitempty"`
	Limit                     *int             `json:"limit,omitempty"`
}

func (r BrowseMarketplaceServiceListingsRequest) Validate() []common.ValidationError {
	return nil
}

type BrowseMarketplaceServiceListingsResponse struct {
	ServiceListings []ServiceListingSummary `json:"service_listings"`
	NextCursor      *string                 `json:"next_cursor,omitempty"`
}

type GetPublicMarketplaceServiceListingRequest struct {
	ServiceListingID string `json:"service_listing_id"`
	HomeRegion       string `json:"home_region"`
}

func (r GetPublicMarketplaceServiceListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ServiceListingID == "" {
		errs = append(errs, common.NewValidationError("service_listing_id", fmt.Errorf("service_listing_id is required")))
	}
	if r.HomeRegion == "" {
		errs = append(errs, common.NewValidationError("home_region", fmt.Errorf("home_region is required")))
	}
	return errs
}

type ReportMarketplaceServiceListingRequest struct {
	ServiceListingID string       `json:"service_listing_id"`
	HomeRegion       string       `json:"home_region"`
	Reason           ReportReason `json:"reason"`
	ReasonOther      *string      `json:"reason_other,omitempty"`
}

func (r ReportMarketplaceServiceListingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ServiceListingID == "" {
		errs = append(errs, common.NewValidationError("service_listing_id", fmt.Errorf("service_listing_id is required")))
	}
	if r.HomeRegion == "" {
		errs = append(errs, common.NewValidationError("home_region", fmt.Errorf("home_region is required")))
	}
	if !validReportReasons[r.Reason] {
		errs = append(errs, common.NewValidationError("reason", fmt.Errorf("reason must be a valid report reason")))
	} else if r.Reason == ReportReasonOther {
		if r.ReasonOther == nil || *r.ReasonOther == "" {
			errs = append(errs, common.NewValidationError("reason_other", fmt.Errorf("reason_other is required when reason is 'other'")))
		} else if len(*r.ReasonOther) > maxReportOther {
			errs = append(errs, common.NewValidationError("reason_other", fmt.Errorf("reason_other must be at most %d characters", maxReportOther)))
		}
	}
	return errs
}
