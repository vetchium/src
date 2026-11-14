package openings

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"
)

type OpeningSearchKeyword string
type OrgSuggestionQuery string
type OpeningSearchPageSize int32
type OpeningSearchExperienceYears int32
type OpeningSearchPostedWithinDays int32

const (
	PostedWithinDay   OpeningSearchPostedWithinDays = 1
	PostedWithinWeek  OpeningSearchPostedWithinDays = 7
	PostedWithinMonth OpeningSearchPostedWithinDays = 30
)

const (
	DefaultOpeningSearchLimit = 20
	MaxOpeningSearchLimit     = 50
	MaxOpeningOrgSuggestions  = 10
)

type OpeningSearchSort string

const (
	SortNewest        OpeningSearchSort = "newest"
	SortIdealJobMatch OpeningSearchSort = "ideal_job_match"
)

func isOpeningSearchSort(value OpeningSearchSort) bool {
	return value == SortNewest || value == SortIdealJobMatch
}

func effectiveSort(sort *OpeningSearchSort) OpeningSearchSort {
	if sort == nil {
		return SortNewest
	}
	return *sort
}

// OpeningSearchFilters holds the filters of one search (OPN-SRCH-004).
type OpeningSearchFilters struct {
	Keyword          *OpeningSearchKeyword           `json:"keyword,omitempty"`
	OrgDomain        *orgs.OrgDomain                 `json:"org_domain,omitempty"`
	TagOIDs          []common.OpeningTagOID          `json:"tag_oids,omitempty"`
	WorkCountries    []common.CountryCode            `json:"work_countries,omitempty"`
	WorkArrangements []common.OpeningWorkArrangement `json:"work_arrangements,omitempty"`
	EmploymentTypes  []common.OpeningEmploymentType  `json:"employment_types,omitempty"`
	PostedWithinDays *OpeningSearchPostedWithinDays  `json:"posted_within_days,omitempty"`
	ExperienceYears  *OpeningSearchExperienceYears   `json:"experience_years,omitempty"`
	EducationLevel   *common.OpeningEducation        `json:"education_level,omitempty"`
	SalaryDisclosed  *bool                           `json:"salary_disclosed,omitempty"`
	PaginationKey    *common.PaginationKey           `json:"pagination_key,omitempty"`
	Limit            *OpeningSearchPageSize          `json:"limit,omitempty"`
}

func (q *OpeningSearchFilters) Normalize() {
	if q.Keyword != nil {
		value := OpeningSearchKeyword(strings.TrimSpace(string(*q.Keyword)))
		q.Keyword = &value
	}
	if q.OrgDomain != nil {
		value := orgs.NormalizeOrgDomain(*q.OrgDomain)
		q.OrgDomain = &value
	}
	if q.WorkCountries != nil {
		countries := make([]common.CountryCode, len(q.WorkCountries))
		for i, country := range q.WorkCountries {
			countries[i] = common.CountryCode(strings.ToUpper(strings.TrimSpace(string(country))))
		}
		q.WorkCountries = countries
	}
}

func (q OpeningSearchFilters) EffectiveLimit() int32 {
	if q.Limit == nil {
		return DefaultOpeningSearchLimit
	}
	return int32(*q.Limit)
}

func (q OpeningSearchFilters) Validate() []string {
	fields := []string{}
	if q.Keyword != nil {
		size := utf8.RuneCountInString(string(*q.Keyword))
		if size < 2 || size > 200 {
			fields = append(fields, "keyword")
		}
	}
	if q.OrgDomain != nil && !orgs.IsOrgDomain(*q.OrgDomain) {
		fields = append(fields, "org_domain")
	}
	fields = append(fields, validateList("tag_oids", q.TagOIDs, 5, common.IsOpeningTagOID)...)
	fields = append(fields, validateList("work_countries", q.WorkCountries, 10, common.IsCountryCode)...)
	fields = append(fields, validateList("work_arrangements", q.WorkArrangements, 3, isWorkArrangement)...)
	fields = append(fields, validateList("employment_types", q.EmploymentTypes, 4, isEmploymentType)...)
	if q.PostedWithinDays != nil {
		switch *q.PostedWithinDays {
		case PostedWithinDay, PostedWithinWeek, PostedWithinMonth:
		default:
			fields = append(fields, "posted_within_days")
		}
	}
	if q.ExperienceYears != nil && (*q.ExperienceYears < 0 || *q.ExperienceYears > 50) {
		fields = append(fields, "experience_years")
	}
	if q.EducationLevel != nil && !isEducation(*q.EducationLevel) {
		fields = append(fields, "education_level")
	}
	if q.PaginationKey != nil && !common.IsPaginationKey(*q.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if limit := q.EffectiveLimit(); limit < 1 || limit > MaxOpeningSearchLimit {
		fields = append(fields, "limit")
	}
	return fields
}

// validateList reports a present list outside 1..max as field, and a
// malformed or repeated item as field.<index>.
func validateList[T comparable](field string, items []T, max int, valid func(T) bool) []string {
	if items == nil {
		return nil
	}
	fields := []string{}
	if len(items) < 1 || len(items) > max {
		fields = append(fields, field)
	}
	seen := map[T]bool{}
	for i, item := range items {
		if !valid(item) || seen[item] {
			fields = append(fields, fmt.Sprintf("%s.%d", field, i))
		}
		seen[item] = true
	}
	return fields
}

func isWorkArrangement(value common.OpeningWorkArrangement) bool {
	return value == common.OpeningOnSite || value == common.OpeningHybrid || value == common.OpeningRemote
}

func isEmploymentType(value common.OpeningEmploymentType) bool {
	return value == common.OpeningFullTime || value == common.OpeningPartTime ||
		value == common.OpeningContract || value == common.OpeningInternship
}

func isEducation(value common.OpeningEducation) bool {
	return value == common.OpeningSecondary || value == common.OpeningBachelor ||
		value == common.OpeningMaster || value == common.OpeningDoctorate
}

// OpeningSearchQuery is one search as the answering tenant runs it: the relay
// and peer body and the reader input. It names no viewer (OPN-SRCH-002).
type OpeningSearchQuery struct {
	OpeningSearchFilters
	Sort *OpeningSearchSort `json:"sort,omitempty"`
	// IdealJobText is present exactly under SortIdealJobMatch. Use it only to
	// match and rank; never log, store, or audit it (OPN-SRCH-014).
	IdealJobText *hub.IdealJob `json:"ideal_job_text,omitempty"`
}

func (q *OpeningSearchQuery) Normalize() {
	q.OpeningSearchFilters.Normalize()
	if q.IdealJobText != nil {
		value := hub.IdealJob(strings.TrimSpace(string(*q.IdealJobText)))
		q.IdealJobText = &value
	}
}

func (q OpeningSearchQuery) EffectiveSort() OpeningSearchSort { return effectiveSort(q.Sort) }

func (q OpeningSearchQuery) Validate() []string {
	fields := q.OpeningSearchFilters.Validate()
	if q.Sort != nil && !isOpeningSearchSort(*q.Sort) {
		fields = append(fields, "sort")
	}
	switch q.EffectiveSort() {
	case SortIdealJobMatch:
		if q.IdealJobText == nil || *q.IdealJobText == "" ||
			utf8.RuneCountInString(string(*q.IdealJobText)) > hub.MaxIdealJobCodePoints {
			fields = append(fields, "ideal_job_text")
		}
	default:
		if q.IdealJobText != nil {
			fields = append(fields, "ideal_job_text")
		}
	}
	return fields
}

// SearchOpeningsRequest carries no ideal-job text: hub-api reads the caller's
// own (OPN-SRCH-013), and the strict decoder refuses one.
type SearchOpeningsRequest struct {
	OpeningSearchFilters
	Sort   *OpeningSearchSort  `json:"sort,omitempty"`
	Region *directory.TenantID `json:"region,omitempty"`
}

func (r *SearchOpeningsRequest) Normalize() { r.OpeningSearchFilters.Normalize() }

func (r SearchOpeningsRequest) EffectiveSort() OpeningSearchSort { return effectiveSort(r.Sort) }

func (r SearchOpeningsRequest) Validate() []string {
	fields := r.OpeningSearchFilters.Validate()
	if r.Sort != nil && !isOpeningSearchSort(*r.Sort) {
		fields = append(fields, "sort")
	}
	if r.Region != nil && !directory.IsTenantID(*r.Region) {
		fields = append(fields, "region")
	}
	return fields
}

type OpeningSearchResult struct {
	Org     PublicOrg            `json:"org"`
	Opening PublicOpeningSummary `json:"opening"`
}

type SearchOpeningsResponse struct {
	Openings          []OpeningSearchResult `json:"openings"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

func (r SearchOpeningsResponse) MarshalJSON() ([]byte, error) {
	type plain SearchOpeningsResponse
	if r.Openings == nil {
		r.Openings = []OpeningSearchResult{}
	}
	return json.Marshal(plain(r))
}

type SuggestOpeningOrgsQuery struct {
	Query OrgSuggestionQuery `json:"query"`
}

func (q *SuggestOpeningOrgsQuery) Normalize() {
	q.Query = OrgSuggestionQuery(strings.TrimSpace(string(q.Query)))
}

func (q SuggestOpeningOrgsQuery) Validate() []string {
	if size := utf8.RuneCountInString(string(q.Query)); size < 2 || size > 100 {
		return []string{"query"}
	}
	return []string{}
}

type SuggestOpeningOrgsRequest struct {
	SuggestOpeningOrgsQuery
	Region *directory.TenantID `json:"region,omitempty"`
}

func (r *SuggestOpeningOrgsRequest) Normalize() { r.SuggestOpeningOrgsQuery.Normalize() }

func (r SuggestOpeningOrgsRequest) Validate() []string {
	fields := r.SuggestOpeningOrgsQuery.Validate()
	if r.Region != nil && !directory.IsTenantID(*r.Region) {
		fields = append(fields, "region")
	}
	return fields
}

type SuggestOpeningOrgsResponse struct {
	Orgs []PublicOrg `json:"orgs"`
}

func (r SuggestOpeningOrgsResponse) MarshalJSON() ([]byte, error) {
	type plain SuggestOpeningOrgsResponse
	if r.Orgs == nil {
		r.Orgs = []PublicOrg{}
	}
	return json.Marshal(plain(r))
}

// RelaySearchOpeningsRequest asks the local relay to search TenantID. No
// viewer identity crosses the mesh (OPN-SRCH-002).
type RelaySearchOpeningsRequest struct {
	TenantID directory.TenantID `json:"tenant_id"`
	Query    OpeningSearchQuery `json:"query"`
}

func (r *RelaySearchOpeningsRequest) Normalize() { r.Query.Normalize() }

func (r RelaySearchOpeningsRequest) Validate() []string {
	fields := []string{}
	if !directory.IsTenantID(r.TenantID) {
		fields = append(fields, "tenant_id")
	}
	for _, field := range r.Query.Validate() {
		fields = append(fields, "query."+field)
	}
	return fields
}

// RelaySuggestOpeningOrgsRequest asks the local relay for TenantID's Org
// suggestions. No viewer identity crosses the mesh (OPN-SRCH-002).
type RelaySuggestOpeningOrgsRequest struct {
	TenantID directory.TenantID      `json:"tenant_id"`
	Query    SuggestOpeningOrgsQuery `json:"query"`
}

func (r *RelaySuggestOpeningOrgsRequest) Normalize() { r.Query.Normalize() }

func (r RelaySuggestOpeningOrgsRequest) Validate() []string {
	fields := []string{}
	if !directory.IsTenantID(r.TenantID) {
		fields = append(fields, "tenant_id")
	}
	for _, field := range r.Query.Validate() {
		fields = append(fields, "query."+field)
	}
	return fields
}

type PeerSearchOpeningsRequest = OpeningSearchQuery
type PeerSuggestOpeningOrgsRequest = SuggestOpeningOrgsQuery
