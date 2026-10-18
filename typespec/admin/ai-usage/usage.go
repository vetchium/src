// Package aiusage contains the Admin API's Org AI usage wire types.
package aiusage

import (
	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/ai"
)

const defaultLimit = 50

type ListOrgAIUsageRequest struct {
	OrgDomain     orgs.OrgDomain        `json:"org_domain"`
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *common.PageSize      `json:"limit,omitempty"`
}

func (r *ListOrgAIUsageRequest) Normalize() {
	r.OrgDomain = orgs.NormalizeOrgDomain(r.OrgDomain)
}

func (r ListOrgAIUsageRequest) EffectiveLimit() common.PageSize {
	if r.Limit == nil {
		return defaultLimit
	}
	return *r.Limit
}

func (r ListOrgAIUsageRequest) Validate() []string {
	var fields []string
	if !orgs.IsOrgDomain(r.OrgDomain) {
		fields = append(fields, "org_domain")
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if !common.IsPageSize(r.EffectiveLimit()) {
		fields = append(fields, "limit")
	}
	return fields
}

type ListOrgAIUsageResponse struct {
	Entries           []ai.AIUsage          `json:"entries"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type GetOrgAIUsageTextRequest struct {
	OrgDomain orgs.OrgDomain `json:"org_domain"`
	UsageID   ai.AIUsageID   `json:"usage_id"`
}

func (r *GetOrgAIUsageTextRequest) Normalize() {
	r.OrgDomain = orgs.NormalizeOrgDomain(r.OrgDomain)
}

func (r GetOrgAIUsageTextRequest) Validate() []string {
	var fields []string
	if !orgs.IsOrgDomain(r.OrgDomain) {
		fields = append(fields, "org_domain")
	}
	if !ai.IsAIUsageID(r.UsageID) {
		fields = append(fields, "usage_id")
	}
	return fields
}
