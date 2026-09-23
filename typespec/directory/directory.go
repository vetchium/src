package directory

import (
	"regexp"
	"time"

	"github.com/vetchium/src/typespec/hub"
)

type HubAlias string
type TenantID string
type CommandID string
type ProfileSlugKind string
type PrincipalState string

const (
	ProfileSlugKindHandle ProfileSlugKind = "handle"
	ProfileSlugKindAlias  ProfileSlugKind = "alias"
	PrincipalProvisioning PrincipalState  = "provisioning"
	PrincipalActive       PrincipalState  = "active"
)

var (
	aliasPattern    = regexp.MustCompile(`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`)
	tenantPattern   = regexp.MustCompile(`^[a-z][a-z0-9]{2,15}$`)
	uuidPattern     = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)
	reservedAliases = map[HubAlias]struct{}{
		"api": {}, "admin": {}, "auth": {}, "help": {}, "jobs": {},
		"login": {}, "logout": {}, "media": {}, "org": {}, "privacy": {},
		"settings": {}, "signup": {}, "support": {}, "terms": {}, "u": {},
	}
)

func IsHubAlias(value HubAlias) bool {
	text := string(value)
	_, reserved := reservedAliases[value]
	return len(text) >= 3 && len(text) <= 30 && !reserved &&
		aliasPattern.MatchString(text) && !hub.IsHubHandle(hub.HubHandle(text))
}

func IsTenantID(value TenantID) bool   { return tenantPattern.MatchString(string(value)) }
func IsCommandID(value CommandID) bool { return uuidPattern.MatchString(string(value)) }
func IsProfileSlug(value string) bool {
	return hub.IsHubHandle(hub.HubHandle(value)) || IsHubAlias(HubAlias(value))
}

type ResolveProfileSlugRequest struct {
	Slug string `json:"slug"`
}

func (r *ResolveProfileSlugRequest) Normalize() {}
func (r ResolveProfileSlugRequest) Validate() []string {
	if !IsProfileSlug(r.Slug) {
		return []string{"slug"}
	}
	return []string{}
}

type ResolveProfileSlugResponse struct {
	HubUserDID     hub.HubUserDID  `json:"hub_user_did"`
	Slug           string          `json:"slug"`
	Kind           ProfileSlugKind `json:"kind"`
	HomeTenantID   TenantID        `json:"home_tenant_id"`
	RoutingVersion int64           `json:"routing_version"`
}

type ReserveHubPrincipalRequest struct {
	CommandID             CommandID      `json:"command_id"`
	HubUserDID            hub.HubUserDID `json:"hub_user_did"`
	Handle                hub.HubHandle  `json:"handle"`
	HomeTenantID          TenantID       `json:"home_tenant_id"`
	ProvisioningExpiresAt time.Time      `json:"provisioning_expires_at"`
}

func (r *ReserveHubPrincipalRequest) Normalize() {}
func (r ReserveHubPrincipalRequest) Validate() []string {
	fields := []string{}
	if !IsCommandID(r.CommandID) {
		fields = append(fields, "command_id")
	}
	if !hub.IsHubUserDID(r.HubUserDID) {
		fields = append(fields, "hub_user_did")
	}
	if !hub.IsHubHandle(r.Handle) {
		fields = append(fields, "handle")
	}
	if !IsTenantID(r.HomeTenantID) {
		fields = append(fields, "home_tenant_id")
	}
	if r.ProvisioningExpiresAt.IsZero() {
		fields = append(fields, "provisioning_expires_at")
	}
	return fields
}

type ActivateHubPrincipalRequest struct {
	CommandID  CommandID      `json:"command_id"`
	HubUserDID hub.HubUserDID `json:"hub_user_did"`
}

func (r *ActivateHubPrincipalRequest) Normalize() {}
func (r ActivateHubPrincipalRequest) Validate() []string {
	fields := []string{}
	if !IsCommandID(r.CommandID) {
		fields = append(fields, "command_id")
	}
	if !hub.IsHubUserDID(r.HubUserDID) {
		fields = append(fields, "hub_user_did")
	}
	return fields
}

type SetHubAliasRequest struct {
	CommandID               CommandID      `json:"command_id"`
	HubUserDID              hub.HubUserDID `json:"hub_user_did"`
	ProfileAlias            *HubAlias      `json:"profile_alias"`
	DowngradeReleaseIfAlias *HubAlias      `json:"downgrade_release_if_alias,omitempty"`
}

func (r *SetHubAliasRequest) Normalize() {}
func (r SetHubAliasRequest) Validate() []string {
	fields := []string{}
	if !IsCommandID(r.CommandID) {
		fields = append(fields, "command_id")
	}
	if !hub.IsHubUserDID(r.HubUserDID) {
		fields = append(fields, "hub_user_did")
	}
	if r.ProfileAlias != nil && !IsHubAlias(*r.ProfileAlias) {
		fields = append(fields, "profile_alias")
	}
	if r.DowngradeReleaseIfAlias != nil &&
		(!IsHubAlias(*r.DowngradeReleaseIfAlias) || r.ProfileAlias != nil) {
		fields = append(fields, "downgrade_release_if_alias")
	}
	return fields
}

type PrincipalCommandResponse struct {
	HubUserDID     hub.HubUserDID `json:"hub_user_did"`
	Handle         hub.HubHandle  `json:"handle"`
	ProfileAlias   *HubAlias      `json:"profile_alias"`
	HomeTenantID   TenantID       `json:"home_tenant_id"`
	RoutingVersion int64          `json:"routing_version"`
	State          PrincipalState `json:"state"`
}
