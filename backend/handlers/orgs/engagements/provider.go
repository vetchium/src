package engagements

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	operationspec "github.com/vetchium/src/typespec/orgs/operations"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/engagements"
	"backend/internal/federation/commands"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

func ListClientEngagements(s *orgsruntime.Server) http.HandlerFunc {
	return list(s, marketplace.ProviderParty,
		func(r *http.Request, params sqlc.ListConsumerEngagementsParams) ([]engagements.Fields, error) {
			rows, err := s.Queries.ListProviderEngagements(
				r.Context(), sqlc.ListProviderEngagementsParams(params))
			fields := make([]engagements.Fields, len(rows))
			for index, row := range rows {
				fields[index] = engagements.FromProjectionList(row)
			}
			return fields, err
		})
}

func GetClientEngagement(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request marketplace.GetEngagementRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		id, err := dbvalue.ParseUUID(string(request.EngagementID))
		if err != nil {
			s.InternalError(r.Context(), w, "parse engagement id", err)
			return
		}
		row, err := s.Queries.GetProviderEngagement(r.Context(), sqlc.GetProviderEngagementParams{
			EngagementID: id, OrgDid: identity.OrgDID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.EngagementNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get client engagement", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK,
			engagements.Snapshot(engagements.FromProjection(row)).ViewFor(marketplace.ProviderParty))
	}
}

type providerCommand struct {
	kind federationspec.CommandKind
	// needListing makes the provider's tenant check, before it sends, that
	// the Org still has a `listed` Listing for the Capability on a plan that
	// allows Listings (MKT-DAT-002).
	needListing bool
}

// sendAsProvider serves the provider's writes. The provider's tenant
// authorizes its own user and, for an accept, re-checks the Listing; the
// consumer's tenant, which is authoritative, validates the engagement's
// state and version when it executes the durable command.
func sendAsProvider[R any, PR interface {
	*R
	apiserver.Request
}](
	s *orgsruntime.Server, command providerCommand,
	target func(R) (marketplace.EngagementID, marketplace.EngagementVersion),
	payload func(R, federationspec.EngagementActorPayload) any,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request R
		if !apiserver.Decode(s, w, r, PR(&request)) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		engagementID, version := target(request)
		id, err := dbvalue.ParseUUID(string(engagementID))
		if err != nil {
			s.InternalError(r.Context(), w, "parse engagement id", err)
			return
		}
		held, err := s.Queries.GetProviderEngagement(r.Context(), sqlc.GetProviderEngagementParams{
			EngagementID: id, OrgDid: identity.OrgDID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.EngagementNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "read client engagement", err)
			return
		}
		if command.needListing &&
			!listingAvailable(s, w, r, identity.OrgDID, held.CapabilityOid) {
			return
		}
		info, err := s.Queries.GetOrgMyInfo(r.Context(), identity.UserID)
		if err != nil {
			s.InternalError(r.Context(), w, "read acting user", err)
			return
		}
		digest, err := json.Marshal(request)
		if err != nil {
			s.InternalError(r.Context(), w, "encode engagement request", err)
			return
		}
		sum := sha256.Sum256(digest)
		outcome, err := s.Commands.Send(r.Context(), commands.Request{
			Kind: command.kind,
			Authority: commands.Principal{
				Type: directoryspec.PrincipalOrg, DID: held.ConsumerOrgDid,
			},
			AggregateID: string(engagementID),
			Owner: commands.Owner{
				Type: commands.OwnerOrgUser, ID: dbvalue.FormatUUID(identity.UserID),
			},
			IdempotencyKey: key, RequestDigest: sum[:],
			Payload: payload(request, federationspec.EngagementActorPayload{
				EngagementID: engagementID, Version: version,
				ProviderOrgDID:      orgs.OrgDID(dbvalue.FormatUUID(identity.OrgDID)),
				ProviderDisplayName: info.DisplayName,
				ActorDisplayName:    info.EmailAddress,
			}),
		})
		answer(s, w, r, command.kind, outcome, err)
	}
}

// listingAvailable answers a provider whose Listing cannot take an engagement
// itself, and reports whether the command may be sent: the Org must hold a
// `listed` Listing for the Capability on a plan that allows Listings.
func listingAvailable(
	s *orgsruntime.Server, w http.ResponseWriter, r *http.Request,
	orgDID pgtype.UUID, capability string,
) bool {
	subscription, err := s.Queries.GetOrgSubscription(r.Context(), orgDID)
	if err != nil {
		s.InternalError(r.Context(), w, "read Org plan", err)
		return false
	}
	available := subscriptionspec.AllowsListings(subscriptionspec.Plan(subscription.OrgPlanOid))
	if available {
		listing, err := s.Queries.GetOrgListing(r.Context(), sqlc.GetOrgListingParams{
			OrgDid: orgDID, CapabilityOid: capability,
		})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			s.InternalError(r.Context(), w, "read Listing", err)
			return false
		}
		available = err == nil && listing.ListingState == sqlc.VetchiumOrgListingStateListed
	}
	if !available {
		s.Problem(r.Context(), w, orgsproblem.ListingNotAvailableError)
	}
	return available
}

// answer writes the outcome of a provider command: the typed result as the
// provider sees it, a stored rejection the contract declares, a pending
// operation to poll, or an unreachable consumer tenant.
func answer(
	s *orgsruntime.Server, w http.ResponseWriter, r *http.Request,
	kind federationspec.CommandKind, outcome commands.Outcome, err error,
) {
	if errors.Is(err, commands.ErrIdempotencyConflict) {
		s.Problem(r.Context(), w, problem.IdempotencyKeyConflictError)
		return
	}
	if err != nil {
		s.InternalError(r.Context(), w, "send "+string(kind), err)
		return
	}
	switch outcome.State {
	case commands.StateSucceeded:
		var snapshot federationspec.EngagementSnapshot
		if err := json.Unmarshal(outcome.Response.Body, &snapshot); err != nil ||
			len(snapshot.Validate()) > 0 {
			s.InternalError(r.Context(), w, "decode engagement result",
				fmt.Errorf("invalid result of %s: %v", kind, err))
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, snapshot.ViewFor(marketplace.ProviderParty))
	case commands.StateFailed:
		var details problem.Details
		_ = json.Unmarshal(outcome.Response.Body, &details)
		for _, known := range []problem.Details{
			orgsproblem.EngagementNotFoundError,
			orgsproblem.EngagementStateConflictError,
			orgsproblem.EngagementVersionConflictError,
		} {
			if details.Type == known.Type {
				s.Problem(r.Context(), w, known)
				return
			}
		}
		s.InternalError(r.Context(), w, "map engagement command rejection",
			fmt.Errorf("unexpected rejection %d %s from %s", outcome.Response.Status, details.Type, kind))
	case commands.StatePending:
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusAccepted, operationspec.PendingOperation{
			OperationID: operationspec.OperationID(dbvalue.FormatUUID(outcome.OperationID)),
		})
	default:
		s.Problem(r.Context(), w, orgsproblem.TenantUnavailableError)
	}
}

func AcceptEngagement(s *orgsruntime.Server) http.HandlerFunc {
	return sendAsProvider[marketplace.EngagementTarget](s, providerCommand{
		kind: federationspec.EngagementAcceptKind, needListing: true,
	}, targetOf, func(_ marketplace.EngagementTarget, actor federationspec.EngagementActorPayload) any {
		return actor
	})
}

func DeclineEngagement(s *orgsruntime.Server) http.HandlerFunc {
	return sendAsProvider[marketplace.EngagementTarget](s, providerCommand{
		kind: federationspec.EngagementDeclineKind,
	}, targetOf, func(_ marketplace.EngagementTarget, actor federationspec.EngagementActorPayload) any {
		return actor
	})
}

func EndClientEngagement(s *orgsruntime.Server) http.HandlerFunc {
	return sendAsProvider[marketplace.EndEngagementRequest](s, providerCommand{
		kind: federationspec.EngagementEndKind,
	}, func(request marketplace.EndEngagementRequest) (marketplace.EngagementID, marketplace.EngagementVersion) {
		return request.EngagementID, request.Version
	}, func(request marketplace.EndEngagementRequest, actor federationspec.EngagementActorPayload) any {
		return federationspec.EngagementEndPayload{EngagementActorPayload: actor, Note: request.Note}
	})
}

func SetClientEngagementReference(s *orgsruntime.Server) http.HandlerFunc {
	return sendAsProvider[marketplace.SetEngagementReferenceRequest](s, providerCommand{
		kind: federationspec.EngagementSetReferenceKind,
	}, func(request marketplace.SetEngagementReferenceRequest) (marketplace.EngagementID, marketplace.EngagementVersion) {
		return request.EngagementID, request.Version
	}, func(request marketplace.SetEngagementReferenceRequest, actor federationspec.EngagementActorPayload) any {
		return federationspec.EngagementReferencePayload{EngagementActorPayload: actor, Reference: request.Reference}
	})
}

func targetOf(request marketplace.EngagementTarget) (marketplace.EngagementID, marketplace.EngagementVersion) {
	return request.EngagementID, request.Version
}
