package marketplace

import (
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/hiring"
)

const (
	MaxHeadline          = 200
	MaxDescription       = 10000
	MaxServiceCountries  = 250
	MaxLanguages         = 20
	MaxIndicativePrice   = 500
	MaxConsentDisclosure = 5000
	MaxCheckTypes        = 20
	MinSearchQuery       = 2
	MaxSearchQuery       = 200
	// MaxSearchPage bounds one page of Listing search results.
	MaxSearchPage = 50
)

type ListingVersion int32
type ListingState string

const (
	DraftListing    ListingState = "draft"
	ListedListing   ListingState = "listed"
	UnlistedListing ListingState = "unlisted"
)

var listingStates = []ListingState{DraftListing, ListedListing, UnlistedListing}

// ListingStates returns every Listing state this contract version defines.
func ListingStates() []ListingState { return slices.Clone(listingStates) }

func IsListingState(value ListingState) bool {
	return slices.Contains(listingStates, value)
}

func validVersion(value ListingVersion) bool { return value >= 1 }

func textLength(value string) int { return utf8.RuneCountInString(value) }

// storable reports text PostgreSQL can hold: it refuses NUL.
func storable(value string) bool { return !strings.ContainsRune(value, 0) }

// ServiceArea is where a provider serves: worldwide, or a list of countries.
type ServiceArea struct {
	Worldwide bool                 `json:"worldwide"`
	Countries []common.CountryCode `json:"countries"`
}

func normalizeCountries(values []common.CountryCode) []common.CountryCode {
	if values == nil {
		return nil
	}
	normalized := make([]common.CountryCode, len(values))
	for index, value := range values {
		normalized[index] = common.CountryCode(
			strings.ToUpper(strings.TrimSpace(string(value))),
		)
	}
	return normalized
}

func validCountries(values []common.CountryCode, limit int) bool {
	if len(values) > limit {
		return false
	}
	seen := make(map[common.CountryCode]bool, len(values))
	for _, value := range values {
		if !common.IsCountryCode(value) || seen[value] {
			return false
		}
		seen[value] = true
	}
	return true
}

func normalizeLanguages(values []common.LanguageTag) []common.LanguageTag {
	if values == nil {
		return nil
	}
	normalized := make([]common.LanguageTag, len(values))
	for index, value := range values {
		normalized[index] = common.LanguageTag(strings.TrimSpace(string(value)))
	}
	return normalized
}

func validLanguages(values []common.LanguageTag) bool {
	if values == nil || len(values) > MaxLanguages {
		return false
	}
	seen := make(map[common.LanguageTag]bool, len(values))
	for _, value := range values {
		if !common.IsLanguageTag(value) || seen[value] {
			return false
		}
		seen[value] = true
	}
	return true
}

func validCheckTypes(values []hiring.CheckType) bool {
	if len(values) < 1 || len(values) > MaxCheckTypes {
		return false
	}
	seen := make(map[hiring.CheckType]bool, len(values))
	for _, value := range values {
		if !hiring.IsCheckType(value) || seen[value] {
			return false
		}
		seen[value] = true
	}
	return true
}

func normalizeText(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	return &trimmed
}

func validOptionalText(value *string, limit int) bool {
	if value == nil {
		return true
	}
	length := textLength(*value)
	return length >= 1 && length <= limit && storable(*value)
}

// ListingContent is what a provider declares on a Listing. Only a
// `background_check` Listing carries check types and a consent disclosure.
type ListingContent struct {
	Headline          string               `json:"headline"`
	Description       string               `json:"description"`
	Service           ServiceArea          `json:"service"`
	Languages         []common.LanguageTag `json:"languages"`
	IndicativePrice   *string              `json:"indicative_price,omitempty"`
	CheckTypes        []hiring.CheckType   `json:"check_types,omitempty"`
	ConsentDisclosure *string              `json:"consent_disclosure,omitempty"`
}

// Normalized returns a normalized copy that shares no storage with c.
func (c ListingContent) Normalized() ListingContent {
	normalized := ListingContent{
		Headline:    strings.TrimSpace(c.Headline),
		Description: strings.TrimSpace(c.Description),
		Service: ServiceArea{
			Worldwide: c.Service.Worldwide,
			Countries: normalizeCountries(c.Service.Countries),
		},
		Languages:         normalizeLanguages(c.Languages),
		IndicativePrice:   normalizeText(c.IndicativePrice),
		ConsentDisclosure: normalizeText(c.ConsentDisclosure),
	}
	if c.CheckTypes != nil {
		normalized.CheckTypes = slices.Clone(c.CheckTypes)
	}
	return normalized
}

// ValidateFor reports invalid fields of a Listing of the given Capability.
func (c ListingContent) ValidateFor(capability Capability) []string {
	fields := []string{}
	if n := textLength(c.Headline); n < 1 || n > MaxHeadline ||
		!storable(c.Headline) {
		fields = append(fields, "headline")
	}
	if n := textLength(c.Description); n < 1 || n > MaxDescription ||
		!storable(c.Description) {
		fields = append(fields, "description")
	}
	if c.Service.Worldwide {
		if len(c.Service.Countries) != 0 {
			fields = append(fields, "service.countries")
		}
	} else if len(c.Service.Countries) < 1 ||
		!validCountries(c.Service.Countries, MaxServiceCountries) {
		fields = append(fields, "service.countries")
	}
	if !validLanguages(c.Languages) {
		fields = append(fields, "languages")
	}
	if !validOptionalText(c.IndicativePrice, MaxIndicativePrice) {
		fields = append(fields, "indicative_price")
	}
	if capability == BackgroundCheck {
		if !validCheckTypes(c.CheckTypes) {
			fields = append(fields, "check_types")
		}
		if c.ConsentDisclosure == nil ||
			!validOptionalText(c.ConsentDisclosure, MaxConsentDisclosure) {
			fields = append(fields, "consent_disclosure")
		}
		return fields
	}
	if c.CheckTypes != nil {
		fields = append(fields, "check_types")
	}
	if c.ConsentDisclosure != nil {
		fields = append(fields, "consent_disclosure")
	}
	return fields
}

// Listing is an Org's own Listing.
type Listing struct {
	Capability Capability     `json:"capability"`
	State      ListingState   `json:"state"`
	Version    ListingVersion `json:"version"`
	ListingContent
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ListListingsRequest struct{}

func (r *ListListingsRequest) Normalize() {}

func (r ListListingsRequest) Validate() []string { return []string{} }

// ListListingsResponse holds at most one Listing per Capability, so the list
// is never paginated.
type ListListingsResponse struct {
	Listings []Listing `json:"listings"`
}

type CreateListingRequest struct {
	Capability Capability `json:"capability"`
	ListingContent
}

func (r *CreateListingRequest) Normalize() {
	r.ListingContent = r.Normalized()
}

func (r CreateListingRequest) Validate() []string {
	fields := []string{}
	if !IsCapability(r.Capability) {
		return append(fields, "capability")
	}
	return append(fields, r.ValidateFor(r.Capability)...)
}

// UpdateListingRequest replaces the whole content of the Listing.
type UpdateListingRequest struct {
	Capability Capability     `json:"capability"`
	Version    ListingVersion `json:"version"`
	ListingContent
}

func (r *UpdateListingRequest) Normalize() {
	r.ListingContent = r.Normalized()
}

func (r UpdateListingRequest) Validate() []string {
	fields := []string{}
	if !validVersion(r.Version) {
		fields = append(fields, "version")
	}
	if !IsCapability(r.Capability) {
		return append(fields, "capability")
	}
	return append(fields, r.ValidateFor(r.Capability)...)
}

// ListingTarget names the Listing an action applies to and the version the
// caller read.
type ListingTarget struct {
	Capability Capability     `json:"capability"`
	Version    ListingVersion `json:"version"`
}

func (r *ListingTarget) Normalize() {}

func (r ListingTarget) Validate() []string {
	fields := []string{}
	if !IsCapability(r.Capability) {
		fields = append(fields, "capability")
	}
	if !validVersion(r.Version) {
		fields = append(fields, "version")
	}
	return fields
}

// ListingProvider is the provider as search and Listing detail show it.
type ListingProvider struct {
	Domain      orgs.OrgDomain     `json:"domain"`
	DisplayName string             `json:"display_name"`
	LogoURL     *string            `json:"logo_url,omitempty"`
	Country     common.CountryCode `json:"country"`
}

type ListingSummary struct {
	Provider        ListingProvider      `json:"provider"`
	Capability      Capability           `json:"capability"`
	Headline        string               `json:"headline"`
	Service         ServiceArea          `json:"service"`
	Languages       []common.LanguageTag `json:"languages"`
	IndicativePrice *string              `json:"indicative_price,omitempty"`
	CheckTypes      []hiring.CheckType   `json:"check_types,omitempty"`
}

type ListingDetail struct {
	ListingSummary
	Description       string  `json:"description"`
	ConsentDisclosure *string `json:"consent_disclosure,omitempty"`
}

type SearchListingsRequest struct {
	Capability    Capability            `json:"capability"`
	Country       *common.CountryCode   `json:"country,omitempty"`
	Language      *common.LanguageTag   `json:"language,omitempty"`
	CheckTypes    []hiring.CheckType    `json:"check_types,omitempty"`
	Query         *string               `json:"query,omitempty"`
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *int32                `json:"limit,omitempty"`
}

func (r *SearchListingsRequest) Normalize() {
	if r.Country != nil {
		value := common.CountryCode(
			strings.ToUpper(strings.TrimSpace(string(*r.Country))),
		)
		r.Country = &value
	}
	if r.Language != nil {
		value := common.LanguageTag(strings.TrimSpace(string(*r.Language)))
		r.Language = &value
	}
	r.Query = normalizeText(r.Query)
}

func (r SearchListingsRequest) EffectiveLimit() int32 {
	if r.Limit == nil {
		return MaxSearchPage
	}
	return *r.Limit
}

func (r SearchListingsRequest) Validate() []string {
	fields := []string{}
	if !IsCapability(r.Capability) {
		fields = append(fields, "capability")
	}
	if r.Country != nil && !common.IsCountryCode(*r.Country) {
		fields = append(fields, "country")
	}
	if r.Language != nil && !common.IsLanguageTag(*r.Language) {
		fields = append(fields, "language")
	}
	if r.CheckTypes != nil &&
		(r.Capability != BackgroundCheck || !validCheckTypes(r.CheckTypes)) {
		fields = append(fields, "check_types")
	}
	if r.Query != nil {
		if n := textLength(*r.Query); n < MinSearchQuery ||
			n > MaxSearchQuery || !storable(*r.Query) {
			fields = append(fields, "query")
		}
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > MaxSearchPage) {
		fields = append(fields, "limit")
	}
	return fields
}

type SearchListingsResponse struct {
	Listings []ListingSummary `json:"listings"`
	// UnavailableTenants did not answer before the deadline, so the results
	// are incomplete.
	UnavailableTenants []directoryspec.TenantID `json:"unavailable_tenants"`
	NextPaginationKey  *common.PaginationKey    `json:"next_pagination_key,omitempty"`
}

type GetListingRequest struct {
	Domain     orgs.OrgDomain `json:"domain"`
	Capability Capability     `json:"capability"`
}

func (r *GetListingRequest) Normalize() {
	r.Domain = orgs.NormalizeOrgDomain(r.Domain)
}

func (r GetListingRequest) Validate() []string {
	fields := []string{}
	if !orgs.IsOrgDomain(r.Domain) {
		fields = append(fields, "domain")
	}
	if !IsCapability(r.Capability) {
		fields = append(fields, "capability")
	}
	return fields
}
