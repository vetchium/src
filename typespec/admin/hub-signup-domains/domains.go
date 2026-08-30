package hubsignupdomains

import (
	"regexp"
	"strings"
	"time"

	adminspec "github.com/vetchium/src/typespec/admin"
	"github.com/vetchium/src/typespec/common"
)

type DomainName string
type State string
type DomainFilterText string
type DisableComment string

const (
	Active   State = "active"
	Disabled State = "disabled"
)

var domainLabelPattern = regexp.MustCompile(
	`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`,
)
var numericDomainPattern = regexp.MustCompile(`^[0-9.]+$`)
var topLevelLetterPattern = regexp.MustCompile(`[a-z]`)
var domainFilterPattern = regexp.MustCompile(`^[a-z0-9.-]+$`)

type Domain struct {
	HubSignupDomainID adminspec.HubSignupDomainID `json:"hub_signup_domain_id"`
	Domain            DomainName                  `json:"domain"`
	State             State                       `json:"state"`
	DisabledComment   *DisableComment             `json:"disabled_comment,omitempty"`
	CreatedAt         time.Time                   `json:"created_at"`
	UpdatedAt         time.Time                   `json:"updated_at"`
}

type ListRequest struct {
	Limit         *common.PageSize      `json:"limit,omitempty"`
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	FilterSearch  *DomainFilterText     `json:"filter_search,omitempty"`
	FilterState   *State                `json:"filter_state,omitempty"`
}

func (r *ListRequest) Normalize() {
	if r.FilterSearch != nil {
		value := DomainFilterText(strings.ToLower(strings.TrimSpace(
			string(*r.FilterSearch),
		)))
		r.FilterSearch = &value
	}
}

func (r ListRequest) EffectiveLimit() common.PageSize {
	if r.Limit == nil {
		return 50
	}
	return *r.Limit
}

func (r ListRequest) Validate() []string {
	fields := make([]string, 0, 4)
	if !common.IsPageSize(r.EffectiveLimit()) {
		fields = append(fields, "limit")
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if r.FilterSearch != nil && !isDomainFilterText(*r.FilterSearch) {
		fields = append(fields, "filter_search")
	}
	if r.FilterState != nil && !IsState(*r.FilterState) {
		fields = append(fields, "filter_state")
	}
	return fields
}

type ListResponse struct {
	Domains           []Domain              `json:"domains"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type CreateRequest struct {
	Domain          DomainName      `json:"domain"`
	State           *State          `json:"state,omitempty"`
	DisabledComment *DisableComment `json:"disabled_comment,omitempty"`
}

func (r *CreateRequest) Normalize() {
	r.Domain = NormalizeDomainName(r.Domain)
	r.DisabledComment = normalizeDisableComment(r.DisabledComment)
}

func (r CreateRequest) EffectiveState() State {
	if r.State == nil {
		return Active
	}
	return *r.State
}

func (r CreateRequest) Validate() []string {
	fields := make([]string, 0, 3)
	if !IsDomainName(r.Domain) {
		fields = append(fields, "domain")
	}
	if !IsState(r.EffectiveState()) {
		fields = append(fields, "state")
	}
	if !isDisableCommentForState(r.EffectiveState(), r.DisabledComment) {
		fields = append(fields, "disabled_comment")
	}
	return fields
}

type UpdateRequest struct {
	HubSignupDomainID adminspec.HubSignupDomainID `json:"hub_signup_domain_id"`
	Domain            DomainName                  `json:"domain"`
	State             State                       `json:"state"`
	DisabledComment   *DisableComment             `json:"disabled_comment,omitempty"`
}

func (r *UpdateRequest) Normalize() {
	r.Domain = NormalizeDomainName(r.Domain)
	r.DisabledComment = normalizeDisableComment(r.DisabledComment)
}

func (r UpdateRequest) Validate() []string {
	fields := make([]string, 0, 4)
	if !adminspec.IsHubSignupDomainID(r.HubSignupDomainID) {
		fields = append(fields, "hub_signup_domain_id")
	}
	if !IsDomainName(r.Domain) {
		fields = append(fields, "domain")
	}
	if !IsState(r.State) {
		fields = append(fields, "state")
	}
	if !isDisableCommentForState(r.State, r.DisabledComment) {
		fields = append(fields, "disabled_comment")
	}
	return fields
}

func NormalizeDomainName(value DomainName) DomainName {
	normalized := strings.ToLower(strings.TrimSpace(string(value)))
	normalized = strings.TrimSuffix(normalized, ".")
	return DomainName(normalized)
}

func IsDomainName(value DomainName) bool {
	normalized := string(NormalizeDomainName(value))
	if len(normalized) < 3 || len(normalized) > 253 ||
		strings.Count(normalized, ".") < 1 ||
		numericDomainPattern.MatchString(normalized) ||
		!topLevelLetterPattern.MatchString(
			strings.Split(normalized, ".")[strings.Count(normalized, ".")],
		) {
		return false
	}
	for _, label := range strings.Split(normalized, ".") {
		if !domainLabelPattern.MatchString(label) {
			return false
		}
	}
	return true
}

func IsState(value State) bool {
	return value == Active || value == Disabled
}

func IsDisableComment(value DisableComment) bool {
	length := len([]rune(strings.TrimSpace(string(value))))
	return length >= 1 && length <= 500
}

func normalizeDisableComment(value *DisableComment) *DisableComment {
	if value == nil {
		return nil
	}
	normalized := DisableComment(strings.TrimSpace(string(*value)))
	return &normalized
}

func isDisableCommentForState(state State, comment *DisableComment) bool {
	if state == Disabled {
		return comment != nil && IsDisableComment(*comment)
	}
	return comment == nil
}

func isDomainFilterText(value DomainFilterText) bool {
	normalized := strings.ToLower(strings.TrimSpace(string(value)))
	return len(normalized) >= 1 && len(normalized) <= 253 &&
		domainFilterPattern.MatchString(normalized)
}
