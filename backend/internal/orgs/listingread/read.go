// Package listingread reads a provider's `listed` Listing from the tenant
// that holds it, for a caller that has the provider's domain. Listing detail
// and a consumer's proposal both start here.
package listingread

import (
	"context"
	"errors"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/listingclient"
)

// Directory is the part of the global directory the read needs.
type Directory interface {
	ResolveOrgDomain(
		context.Context, directoryspec.ResolveOrgDomainRequest,
	) (directoryspec.ResolveOrgDomainResponse, *problem.Details, error)
	ResolvePrincipal(
		context.Context, directoryspec.ResolvePrincipalRequest,
	) (directoryspec.ResolvePrincipalResponse, *problem.Details, error)
}

// LocalOrgs finds an Org this tenant homes.
type LocalOrgs interface {
	GetLocalOrgForDomain(context.Context, string) (pgtype.UUID, error)
	IsLocalFederationPrincipal(
		context.Context, sqlc.IsLocalFederationPrincipalParams,
	) (bool, error)
}

type Reader struct {
	Listings  *listingclient.Client
	Directory Directory
	Orgs      LocalOrgs
	TenantID  string
	Log       *slog.Logger
}

// Provider is where an Org lives.
type Provider struct {
	OrgDID pgtype.UUID
	Tenant directoryspec.TenantID
}

// Detail reads the Listing at tenant through the local relay. A Listing that
// is not `listed`, or whose provider cannot take engagements, is not found.
func (r Reader) Detail(
	ctx context.Context, tenant directoryspec.TenantID,
	request marketplace.GetListingRequest,
) (*marketplace.ListingDetail, *problem.Details) {
	outcome, err := r.Listings.RelayGet(ctx, marketplace.RelayGetListingRequest{
		Tenant: tenant, Listing: request,
	})
	if err != nil {
		r.Log.WarnContext(ctx, "Listing read failed",
			"event", "listing_read_failed", "peer_tenant", tenant, "error", err)
		return nil, &orgsproblem.TenantUnavailableError
	}
	if outcome.Problem != nil {
		if outcome.Problem.Type == orgsproblem.ListingNotFoundError.Type {
			return nil, &orgsproblem.ListingNotFoundError
		}
		return nil, &orgsproblem.TenantUnavailableError
	}
	return outcome.Result, nil
}

// EngagementListing reads, at the provider's tenant, the Listing behind an
// engagement this Org holds as consumer. An engagement the provider's tenant
// does not hold for this Org is not found.
func (r Reader) EngagementListing(
	ctx context.Context, tenant directoryspec.TenantID,
	request marketplace.PeerEngagementListingRequest,
) (*marketplace.EngagementListing, *problem.Details) {
	outcome, err := r.Listings.RelayEngagementListing(ctx,
		marketplace.RelayEngagementListingRequest{Tenant: tenant, Request: request})
	if err != nil {
		r.Log.WarnContext(ctx, "engagement Listing read failed",
			"event", "engagement_listing_read_failed", "peer_tenant", tenant,
			"error", err)
		return nil, &orgsproblem.TenantUnavailableError
	}
	if outcome.Problem != nil {
		if outcome.Problem.Type == orgsproblem.EngagementNotFoundError.Type {
			return nil, &orgsproblem.EngagementNotFoundError
		}
		return nil, &orgsproblem.TenantUnavailableError
	}
	return outcome.Result, nil
}

// Home asks the global directory where the provider's domain lives. An
// unknown domain is a Listing that does not exist.
func (r Reader) Home(
	ctx context.Context, domain orgs.OrgDomain,
) (Provider, *problem.Details) {
	resolved, details, err := r.Directory.ResolveOrgDomain(
		ctx, directoryspec.ResolveOrgDomainRequest{Domain: domain},
	)
	if err != nil || (details != nil &&
		details.Type != coordinatorproblem.DirectoryEntryNotFoundError.Type) ||
		(details == nil && resolved.Domain != domain) {
		return Provider{}, &orgsproblem.TenantUnavailableError
	}
	if details != nil {
		return Provider{}, &orgsproblem.ListingNotFoundError
	}
	did, err := dbvalue.ParseUUID(string(resolved.OrgDID))
	if err != nil {
		return Provider{}, &orgsproblem.TenantUnavailableError
	}
	return Provider{OrgDID: did, Tenant: resolved.HomeTenantID}, nil
}

// HomeOf finds the tenant that homes the Org with did: this tenant first,
// then the directory. A recorded domain may since have passed to another
// Org, so a counterparty is always found by its DID. An Org the directory no
// longer has answers org-listing-not-found.
func (r Reader) HomeOf(
	ctx context.Context, did pgtype.UUID,
) (directoryspec.TenantID, *problem.Details) {
	local, err := r.Orgs.IsLocalFederationPrincipal(ctx,
		sqlc.IsLocalFederationPrincipalParams{
			PrincipalType: string(directoryspec.PrincipalOrg), PrincipalDid: did,
		})
	if err != nil {
		r.Log.ErrorContext(ctx, "local Org lookup failed",
			"event", "listing_local_lookup_failed", "error", err)
		return "", &problem.InternalServerError
	}
	if local {
		return directoryspec.TenantID(r.TenantID), nil
	}
	resolved, details, err := r.Directory.ResolvePrincipal(ctx,
		directoryspec.ResolvePrincipalRequest{
			PrincipalType: directoryspec.PrincipalOrg,
			PrincipalDID:  directoryspec.PrincipalDID(dbvalue.FormatUUID(did)),
		})
	switch {
	case err == nil && details != nil &&
		details.Type == coordinatorproblem.DirectoryEntryNotFoundError.Type:
		return "", &orgsproblem.ListingNotFoundError
	case err != nil || details != nil:
		return "", &orgsproblem.TenantUnavailableError
	}
	return resolved.HomeTenantID, nil
}

// Locate finds the Org holding domain: in this tenant first, so a local
// provider needs no directory lookup, then in the directory.
func (r Reader) Locate(
	ctx context.Context, domain orgs.OrgDomain,
) (Provider, *problem.Details) {
	did, err := r.Orgs.GetLocalOrgForDomain(ctx, string(domain))
	if err == nil {
		return Provider{OrgDID: did, Tenant: directoryspec.TenantID(r.TenantID)}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		r.Log.ErrorContext(ctx, "local Org lookup failed",
			"event", "listing_local_lookup_failed", "error", err)
		return Provider{}, &problem.InternalServerError
	}
	return r.Home(ctx, domain)
}

// Get reads a provider's `listed` Listing by domain and Capability. This
// tenant is asked first, so a local provider needs no directory lookup;
// otherwise the directory names the provider's tenant.
func (r Reader) Get(
	ctx context.Context, request marketplace.GetListingRequest,
) (*marketplace.ListingDetail, *problem.Details) {
	self := directoryspec.TenantID(r.TenantID)
	detail, details := r.Detail(ctx, self, request)
	if details == nil || details.Type != orgsproblem.ListingNotFoundError.Type {
		return detail, details
	}
	home, details := r.Home(ctx, request.Domain)
	if details != nil {
		return nil, details
	}
	if home.Tenant == self {
		return nil, &orgsproblem.ListingNotFoundError
	}
	return r.Detail(ctx, home.Tenant, request)
}
