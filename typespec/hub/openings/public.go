// Package openings contains the public Hub and mesh Opening wire types.
package openings

import (
	"strings"
	"time"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
)

type OpeningNumber int32
type OpeningPageSize int32
type OpeningTitleQuery string
type PublicOpeningState string

const (
	Published    PublicOpeningState = "published"
	NotAccepting PublicOpeningState = "not_accepting"
)

type PublicOrg struct {
	Domain      orgs.OrgDomain     `json:"domain"`
	DisplayName common.DisplayName `json:"display_name"`
	Country     common.CountryCode `json:"country"`
	LogoURL     *string            `json:"logo_url,omitempty"`
}

type PublicOpeningSummary struct {
	OpeningNumber    OpeningNumber                 `json:"opening_number"`
	Title            string                        `json:"title"`
	EmployingCountry common.CountryCode            `json:"employing_country"`
	WorkArrangement  common.OpeningWorkArrangement `json:"work_arrangement"`
	EmploymentType   common.OpeningEmploymentType  `json:"employment_type"`
	FirstPublishedAt time.Time                     `json:"first_published_at"`
}

type PublicOpening struct {
	OpeningNumber    OpeningNumber          `json:"opening_number"`
	State            PublicOpeningState     `json:"state"`
	Content          *common.OpeningContent `json:"content,omitempty"`
	FirstPublishedAt *time.Time             `json:"first_published_at,omitempty"`
	LastRevisedAt    *time.Time             `json:"last_revised_at,omitempty"`
	Title            *string                `json:"title,omitempty"`
}

type ListOrgOpeningsRequest struct {
	Domain           orgs.OrgDomain                 `json:"domain"`
	EmployingCountry *common.CountryCode            `json:"employing_country,omitempty"`
	WorkArrangement  *common.OpeningWorkArrangement `json:"work_arrangement,omitempty"`
	EmploymentType   *common.OpeningEmploymentType  `json:"employment_type,omitempty"`
	TitleQuery       *OpeningTitleQuery             `json:"title_query,omitempty"`
	PaginationKey    *common.PaginationKey          `json:"pagination_key,omitempty"`
	Limit            *OpeningPageSize               `json:"limit,omitempty"`
}

func (r *ListOrgOpeningsRequest) Normalize() {
	r.Domain = orgs.NormalizeOrgDomain(r.Domain)
	if r.EmployingCountry != nil {
		value := common.CountryCode(strings.ToUpper(strings.TrimSpace(string(*r.EmployingCountry))))
		r.EmployingCountry = &value
	}
	if r.TitleQuery != nil {
		value := OpeningTitleQuery(strings.TrimSpace(string(*r.TitleQuery)))
		r.TitleQuery = &value
	}
}

func (r ListOrgOpeningsRequest) EffectiveLimit() int32 {
	if r.Limit == nil {
		return 50
	}
	return int32(*r.Limit)
}

func (r ListOrgOpeningsRequest) Validate() []string {
	fields := []string{}
	if !orgs.IsOrgDomain(r.Domain) {
		fields = append(fields, "domain")
	}
	if r.EmployingCountry != nil && !common.IsCountryCode(*r.EmployingCountry) {
		fields = append(fields, "employing_country")
	}
	if r.WorkArrangement != nil && *r.WorkArrangement != common.OpeningOnSite && *r.WorkArrangement != common.OpeningHybrid && *r.WorkArrangement != common.OpeningRemote {
		fields = append(fields, "work_arrangement")
	}
	if r.EmploymentType != nil && *r.EmploymentType != common.OpeningFullTime && *r.EmploymentType != common.OpeningPartTime && *r.EmploymentType != common.OpeningContract && *r.EmploymentType != common.OpeningInternship {
		fields = append(fields, "employment_type")
	}
	if r.TitleQuery != nil {
		size := utf8.RuneCountInString(string(*r.TitleQuery))
		if size < 2 || size > 200 {
			fields = append(fields, "title_query")
		}
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if r.EffectiveLimit() < 1 || r.EffectiveLimit() > 50 {
		fields = append(fields, "limit")
	}
	return fields
}

type ListOrgOpeningsResponse struct {
	Org               PublicOrg              `json:"org"`
	Openings          []PublicOpeningSummary `json:"openings"`
	NextPaginationKey *common.PaginationKey  `json:"next_pagination_key,omitempty"`
}

type GetOrgOpeningRequest struct {
	Domain        orgs.OrgDomain `json:"domain"`
	OpeningNumber OpeningNumber  `json:"opening_number"`
}

func (r *GetOrgOpeningRequest) Normalize() {
	r.Domain = orgs.NormalizeOrgDomain(r.Domain)
}

func (r GetOrgOpeningRequest) Validate() []string {
	fields := []string{}
	if !orgs.IsOrgDomain(r.Domain) {
		fields = append(fields, "domain")
	}
	if r.OpeningNumber < 1 {
		fields = append(fields, "opening_number")
	}
	return fields
}

type GetOrgOpeningResponse struct {
	Org     PublicOrg     `json:"org"`
	Opening PublicOpening `json:"opening"`
}
