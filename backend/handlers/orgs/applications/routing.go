package applications

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/engagements"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

// RouteApplication routes a candidacy at its current stage to an engagement
// assigned to that stage, or back in-house (MKT-ASG-003). The caller needs the
// rights to act on the candidacy; the assignment itself is the consumer's
// earlier, separate decision. Rerouting replaces the route, which ends the
// previous provider's access; the work it recorded stays.
func RouteApplication(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.RouteApplicationRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		// A `background_check` provider's Listing is read before the
		// transaction, never inside it: its current consent disclosure is
		// copied onto the route (MKT-DAT-009).
		var listing *marketplace.EngagementListing
		if request.EngagementID != nil {
			var ok bool
			if listing, ok = readEngagementListing(s, w, r, *request.EngagementID); !ok {
				return
			}
		}
		transition{
			operation: "orgs:route-application", request: request,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version,
			check: func(locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) problem.Body {
				// Only a candidacy waiting at a stage is routed; a finished
				// stage, an offer, or a closed candidacy has no work to hand over.
				if details := stateConflict(
					sqlc.VetchiumOrgApplicationStateInPipeline,
				)(locked.ApplicationState); details != nil {
					return details
				}
				if locked.CurrentStageStatus != string(applications.StagePending) {
					return orgsproblem.ApplicationStateConflictError
				}
				return nil
			},
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) (change, bool, error) {
				identity, _ := middleware.OrgIdentityFromContext(r.Context())
				current, err := q.GetApplicationRouteAssignment(ctx, locked.OrgApplicationID)
				routed := err == nil
				if err != nil && !errors.Is(err, pgx.ErrNoRows) {
					return change{}, false, err
				}
				moved := change{
					action: sqlc.VetchiumOrgApplicationHistoryActionRouted, stageID: locked.CurrentStageID,
				}
				if request.EngagementID == nil {
					if !routed {
						return change{refusal: orgsproblem.ApplicationStateConflictError}, false, nil
					}
					row, err := q.ClearOrgApplicationRoute(ctx, sqlc.ClearOrgApplicationRouteParams{
						ApplicationID: locked.OrgApplicationID, Version: locked.Version,
					})
					if err != nil {
						return change{}, false, err
					}
					if row.ChangedRows != 1 || row.RemovedRows != 1 {
						return change{}, false, fmt.Errorf("incomplete route removal")
					}
					if err := engagements.EndWork(ctx, q, current.EngagementID,
						[]pgtype.UUID{locked.OrgApplicationID}); err != nil {
						return change{}, false, err
					}
					return moved, true, nil
				}
				engagementID, err := dbvalue.ParseUUID(string(*request.EngagementID))
				if err != nil {
					return change{}, false, err
				}
				assignment, err := q.GetStageAssignment(ctx, sqlc.GetStageAssignmentParams{
					StageID: locked.CurrentStageID, EngagementID: engagementID,
					OrgDid: identity.OrgDID,
				})
				if errors.Is(err, pgx.ErrNoRows) {
					return change{refusal: orgsproblem.AssignmentNotFoundError}, false, nil
				}
				if err != nil {
					return change{}, false, err
				}
				if assignment.EngagementState != sqlc.VetchiumOrgEngagementStateActive {
					return change{refusal: orgsproblem.EngagementStateConflictError}, false, nil
				}
				if routed && current.AssignmentID == assignment.AssignmentID {
					return change{refusal: orgsproblem.ApplicationStateConflictError}, false, nil
				}
				params := sqlc.RouteOrgApplicationParams{
					ApplicationID: locked.OrgApplicationID, Version: locked.Version,
					AssignmentID: assignment.AssignmentID, ActorID: identity.UserID,
				}
				if marketplace.Capability(assignment.CapabilityOid) == marketplace.BackgroundCheck {
					if listing == nil || listing.ConsentDisclosure == nil {
						return change{}, false, fmt.Errorf("a background-check route without its Listing")
					}
					params.ConsentDisclosure = dbvalue.Text(*listing.ConsentDisclosure)
					params.ListingCheckTypes = make([]string, len(listing.CheckTypes))
					for index, checkType := range listing.CheckTypes {
						params.ListingCheckTypes[index] = string(checkType)
					}
				}
				row, err := q.RouteOrgApplication(ctx, params)
				if err != nil {
					return change{}, false, err
				}
				if row.ChangedRows != 1 || row.PlacedRows != 1 {
					return change{}, false, fmt.Errorf("incomplete route")
				}
				if routed {
					if err := engagements.EndWork(ctx, q, current.EngagementID,
						[]pgtype.UUID{locked.OrgApplicationID}); err != nil {
						return change{}, false, err
					}
				}
				return moved, true, nil
			},
		}.run(s, w, r)
	}
}

// readEngagementListing reads, for a route to a `background_check` provider,
// the Listing behind the engagement from the provider's tenant. Any other
// route reads nothing. It answers an engagement the Org does not hold as an
// unassigned one, and a provider that does not answer as unavailable.
func readEngagementListing(
	s *orgsruntime.Server, w http.ResponseWriter, r *http.Request,
	engagement marketplace.EngagementID,
) (*marketplace.EngagementListing, bool) {
	identity, _ := middleware.OrgIdentityFromContext(r.Context())
	id, err := dbvalue.ParseUUID(string(engagement))
	if err != nil {
		s.InternalError(r.Context(), w, "parse engagement id", err)
		return nil, false
	}
	row, err := s.Queries.GetConsumerEngagement(r.Context(), sqlc.GetConsumerEngagementParams{
		EngagementID: id, OrgDid: identity.OrgDID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		s.Problem(r.Context(), w, orgsproblem.AssignmentNotFoundError)
		return nil, false
	}
	if err != nil {
		s.InternalError(r.Context(), w, "read engagement", err)
		return nil, false
	}
	if marketplace.Capability(row.CapabilityOid) != marketplace.BackgroundCheck {
		return nil, true
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.ListingDeadline)
	defer cancel()
	provider, details := s.ListingRead.Locate(ctx, orgs.OrgDomain(row.ProviderDomain))
	if details != nil || provider.OrgDID != row.ProviderOrgDid {
		s.Problem(r.Context(), w, orgsproblem.TenantUnavailableError)
		return nil, false
	}
	listing, details := s.ListingRead.EngagementListing(ctx,
		directoryspec.TenantID(provider.Tenant),
		marketplace.PeerEngagementListingRequest{
			EngagementID:   engagement,
			ConsumerOrgDID: orgs.OrgDID(dbvalue.FormatUUID(identity.OrgDID)),
		})
	if details != nil {
		if details.Type == orgsproblem.EngagementNotFoundError.Type {
			details = &orgsproblem.AssignmentNotFoundError
		}
		s.Problem(r.Context(), w, *details)
		return nil, false
	}
	return listing, true
}
