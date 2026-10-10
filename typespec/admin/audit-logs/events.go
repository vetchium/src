package auditlogs

import (
	"strings"
	"time"

	hubsignupdomains "github.com/vetchium/src/typespec/admin/hub-signup-domains"
	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
)

// Strings preserve the required Z suffix during validation, before parsing.
type ListRequest struct {
	StartAt       string                       `json:"start_at"`
	EndAt         string                       `json:"end_at"`
	HubHandle     *hub.HubHandle               `json:"hub_handle,omitempty"`
	HubEmail      *common.EmailAddress         `json:"hub_email,omitempty"`
	OrgDomain     *hubsignupdomains.DomainName `json:"org_domain,omitempty"`
	OrgUserEmail  *common.EmailAddress         `json:"org_user_email,omitempty"`
	Limit         *common.PageSize             `json:"limit,omitempty"`
	PaginationKey *common.PaginationKey        `json:"pagination_key,omitempty"`
}

func (r *ListRequest) Normalize() {
	if r.HubHandle != nil {
		v := hub.HubHandle(strings.ToLower(strings.TrimSpace(string(*r.HubHandle))))
		r.HubHandle = &v
	}
	if r.HubEmail != nil {
		v := common.NormalizeEmailAddress(*r.HubEmail)
		r.HubEmail = &v
	}
	if r.OrgUserEmail != nil {
		v := common.NormalizeEmailAddress(*r.OrgUserEmail)
		r.OrgUserEmail = &v
	}
	if r.OrgDomain != nil {
		v := hubsignupdomains.NormalizeDomainName(*r.OrgDomain)
		r.OrgDomain = &v
	}
}
func (r ListRequest) EffectiveLimit() common.PageSize {
	if r.Limit == nil {
		return 50
	}
	return *r.Limit
}
func (r ListRequest) Validate() []string {
	fields := []string{}
	start, startErr := time.Parse(time.RFC3339Nano, r.StartAt)
	end, endErr := time.Parse(time.RFC3339Nano, r.EndAt)
	if startErr != nil || !strings.HasSuffix(r.StartAt, "Z") {
		fields = append(fields, "start_at")
	}
	if endErr != nil || !strings.HasSuffix(r.EndAt, "Z") || (startErr == nil && (end.Before(start) || end.Sub(start) > 31*24*time.Hour)) {
		fields = append(fields, "end_at")
	}
	if r.HubHandle == nil && r.HubEmail == nil && r.OrgDomain == nil && r.OrgUserEmail == nil {
		fields = append(fields, "hub_handle", "hub_email", "org_domain", "org_user_email")
	}
	if r.HubHandle != nil && !hub.IsHubHandle(*r.HubHandle) {
		fields = append(fields, "hub_handle")
	}
	if r.HubEmail != nil && !common.IsEmailAddress(*r.HubEmail) {
		fields = append(fields, "hub_email")
	}
	if r.OrgDomain != nil && !hubsignupdomains.IsDomainName(*r.OrgDomain) {
		fields = append(fields, "org_domain")
	}
	if r.OrgUserEmail != nil && !common.IsEmailAddress(*r.OrgUserEmail) {
		fields = append(fields, "org_user_email")
	}
	if !common.IsPageSize(r.EffectiveLimit()) {
		fields = append(fields, "limit")
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	return fields
}

type Detail struct {
	Field string `json:"field"`
	Value string `json:"value"`
}
type Event struct {
	AuditEventID string    `json:"audit_event_id"`
	CreatedAt    time.Time `json:"created_at"`
	Action       string    `json:"action"`
	EntityType   string    `json:"entity_type"`
	ActorType    string    `json:"actor_type"`
	ActorName    *string   `json:"actor_name,omitempty"`
	Source       string    `json:"source"`
	Details      []Detail  `json:"details"`
}
type ListResponse struct {
	Events            []Event               `json:"events"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}
