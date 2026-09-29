package directory

import (
	"regexp"
	"time"

	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"
)

type HubAlias string
type TenantID string
type CommandID string
type ProfileSlugKind string
type PrincipalState string
type EmailDigest string
type DigestKeyID string
type EmailChangeReservationState string

const (
	ProfileSlugKindHandle ProfileSlugKind = "handle"
	ProfileSlugKindAlias  ProfileSlugKind = "alias"
	PrincipalProvisioning PrincipalState  = "provisioning"
	PrincipalActive       PrincipalState  = "active"

	EmailChangeReserved  EmailChangeReservationState = "reserved"
	EmailChangeCancelled EmailChangeReservationState = "cancelled"
	EmailChangeFinalized EmailChangeReservationState = "finalized"
)

var (
	aliasPattern       = regexp.MustCompile(`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`)
	tenantPattern      = regexp.MustCompile(`^[a-z][a-z0-9]{2,15}$`)
	uuidPattern        = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)
	emailDigestPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
	digestKeyIDPattern = regexp.MustCompile(`^[0-9a-f]{16}$`)
	reservedAliases    = map[HubAlias]struct{}{
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

// IsEmailDigest matches the lowercase hex encoding of a 32-byte
// identitydigest.Key digest. The coordinator never decodes it; it is stored
// and compared as opaque bytes.
func IsEmailDigest(value EmailDigest) bool {
	return emailDigestPattern.MatchString(string(value))
}

// IsDigestKeyID matches the lowercase hex encoding of identitydigest.Key.ID().
func IsDigestKeyID(value DigestKeyID) bool {
	return digestKeyIDPattern.MatchString(string(value))
}

func IsEmailChangeReservationState(value EmailChangeReservationState) bool {
	switch value {
	case EmailChangeReserved, EmailChangeCancelled, EmailChangeFinalized:
		return true
	default:
		return false
	}
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
	AccountEmailDigest    EmailDigest    `json:"account_email_digest"`
	DigestKeyID           DigestKeyID    `json:"digest_key_id"`
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
	if !IsEmailDigest(r.AccountEmailDigest) {
		fields = append(fields, "account_email_digest")
	}
	if !IsDigestKeyID(r.DigestKeyID) {
		fields = append(fields, "digest_key_id")
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

type ResolveOrgDomainRequest struct {
	Domain orgs.OrgDomain `json:"domain"`
}

func (r *ResolveOrgDomainRequest) Normalize() {
	r.Domain = orgs.NormalizeOrgDomain(r.Domain)
}
func (r ResolveOrgDomainRequest) Validate() []string {
	if !orgs.IsOrgDomain(r.Domain) {
		return []string{"domain"}
	}
	return []string{}
}

type ResolveOrgDomainResponse struct {
	OrgDID         orgs.OrgDID    `json:"org_did"`
	Domain         orgs.OrgDomain `json:"domain"`
	HomeTenantID   TenantID       `json:"home_tenant_id"`
	RoutingVersion int64          `json:"routing_version"`
}

type ReserveOrgPrincipalRequest struct {
	CommandID             CommandID      `json:"command_id"`
	OrgDID                orgs.OrgDID    `json:"org_did"`
	Domain                orgs.OrgDomain `json:"domain"`
	HomeTenantID          TenantID       `json:"home_tenant_id"`
	ProvisioningExpiresAt time.Time      `json:"provisioning_expires_at"`
}

func (r *ReserveOrgPrincipalRequest) Normalize() {}
func (r ReserveOrgPrincipalRequest) Validate() []string {
	fields := orgCommandFields(r.CommandID, r.OrgDID)
	if !orgs.IsOrgDomain(r.Domain) {
		fields = append(fields, "domain")
	}
	if !IsTenantID(r.HomeTenantID) {
		fields = append(fields, "home_tenant_id")
	}
	if r.ProvisioningExpiresAt.IsZero() {
		fields = append(fields, "provisioning_expires_at")
	}
	return fields
}

type ActivateOrgPrincipalRequest struct {
	CommandID CommandID   `json:"command_id"`
	OrgDID    orgs.OrgDID `json:"org_did"`
}

func (r *ActivateOrgPrincipalRequest) Normalize() {}
func (r ActivateOrgPrincipalRequest) Validate() []string {
	return orgCommandFields(r.CommandID, r.OrgDID)
}

type ReleaseOrgDomainRequest struct {
	CommandID CommandID      `json:"command_id"`
	OrgDID    orgs.OrgDID    `json:"org_did"`
	Domain    orgs.OrgDomain `json:"domain"`
}

func (r *ReleaseOrgDomainRequest) Normalize() {}
func (r ReleaseOrgDomainRequest) Validate() []string {
	fields := orgCommandFields(r.CommandID, r.OrgDID)
	if !orgs.IsOrgDomain(r.Domain) {
		fields = append(fields, "domain")
	}
	return fields
}

type ClaimOrgDomainRequest struct {
	CommandID CommandID      `json:"command_id"`
	OrgDID    orgs.OrgDID    `json:"org_did"`
	Domain    orgs.OrgDomain `json:"domain"`
}

func (r *ClaimOrgDomainRequest) Normalize() {}
func (r ClaimOrgDomainRequest) Validate() []string {
	fields := orgCommandFields(r.CommandID, r.OrgDID)
	if !orgs.IsOrgDomain(r.Domain) {
		fields = append(fields, "domain")
	}
	return fields
}

type OrgPrincipalCommandResponse struct {
	OrgDID         orgs.OrgDID     `json:"org_did"`
	Domain         *orgs.OrgDomain `json:"domain"`
	HomeTenantID   TenantID        `json:"home_tenant_id"`
	RoutingVersion int64           `json:"routing_version"`
	State          PrincipalState  `json:"state"`
}

func orgCommandFields(commandID CommandID, orgDID orgs.OrgDID) []string {
	fields := []string{}
	if !IsCommandID(commandID) {
		fields = append(fields, "command_id")
	}
	if !orgs.IsOrgDID(orgDID) {
		fields = append(fields, "org_did")
	}
	return fields
}

// ResolveHubAccountEmailRequest resolves a Hub account-email digest, never
// revealing the DID (GU-DIR-001).
type ResolveHubAccountEmailRequest struct {
	EmailDigest EmailDigest `json:"email_digest"`
	DigestKeyID DigestKeyID `json:"digest_key_id"`
}

func (r *ResolveHubAccountEmailRequest) Normalize() {}
func (r ResolveHubAccountEmailRequest) Validate() []string {
	fields := []string{}
	if !IsEmailDigest(r.EmailDigest) {
		fields = append(fields, "email_digest")
	}
	if !IsDigestKeyID(r.DigestKeyID) {
		fields = append(fields, "digest_key_id")
	}
	return fields
}

type ResolveHubAccountEmailResponse struct {
	HomeTenantID TenantID `json:"home_tenant_id"`
}

type ReserveHubAccountEmailChangeRequest struct {
	CommandID      CommandID      `json:"command_id"`
	ChangeID       CommandID      `json:"change_id"`
	HubUserDID     hub.HubUserDID `json:"hub_user_did"`
	NewEmailDigest EmailDigest    `json:"new_email_digest"`
	NotAfter       time.Time      `json:"not_after"`
	DigestKeyID    DigestKeyID    `json:"digest_key_id"`
}

func (r *ReserveHubAccountEmailChangeRequest) Normalize() {}
func (r ReserveHubAccountEmailChangeRequest) Validate() []string {
	fields := []string{}
	if !IsCommandID(r.CommandID) {
		fields = append(fields, "command_id")
	}
	if !IsCommandID(r.ChangeID) {
		fields = append(fields, "change_id")
	}
	if !hub.IsHubUserDID(r.HubUserDID) {
		fields = append(fields, "hub_user_did")
	}
	if !IsEmailDigest(r.NewEmailDigest) {
		fields = append(fields, "new_email_digest")
	}
	if r.NotAfter.IsZero() {
		fields = append(fields, "not_after")
	}
	if !IsDigestKeyID(r.DigestKeyID) {
		fields = append(fields, "digest_key_id")
	}
	return fields
}

type FinalizeHubAccountEmailChangeRequest struct {
	CommandID  CommandID      `json:"command_id"`
	ChangeID   CommandID      `json:"change_id"`
	HubUserDID hub.HubUserDID `json:"hub_user_did"`
}

func (r *FinalizeHubAccountEmailChangeRequest) Normalize() {}
func (r FinalizeHubAccountEmailChangeRequest) Validate() []string {
	return emailChangeCommandFields(r.CommandID, r.ChangeID, r.HubUserDID)
}

type AbandonHubAccountEmailChangeRequest struct {
	CommandID  CommandID      `json:"command_id"`
	ChangeID   CommandID      `json:"change_id"`
	HubUserDID hub.HubUserDID `json:"hub_user_did"`
	NotAfter   time.Time      `json:"not_after"`
}

func (r *AbandonHubAccountEmailChangeRequest) Normalize() {}
func (r AbandonHubAccountEmailChangeRequest) Validate() []string {
	fields := emailChangeCommandFields(r.CommandID, r.ChangeID, r.HubUserDID)
	if r.NotAfter.IsZero() {
		fields = append(fields, "not_after")
	}
	return fields
}

func emailChangeCommandFields(
	commandID, changeID CommandID, hubUserDID hub.HubUserDID,
) []string {
	fields := []string{}
	if !IsCommandID(commandID) {
		fields = append(fields, "command_id")
	}
	if !IsCommandID(changeID) {
		fields = append(fields, "change_id")
	}
	if !hub.IsHubUserDID(hubUserDID) {
		fields = append(fields, "hub_user_did")
	}
	return fields
}

type HubAccountEmailChangeReservationResponse struct {
	State EmailChangeReservationState `json:"state"`
}
