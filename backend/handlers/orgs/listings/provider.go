// Package listings serves the Org marketplace Listings: a provider's own
// Listings, and the search and detail reads of other providers' Listings.
package listings

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

func listingFrom(row sqlc.GetOrgListingRow) marketplace.Listing {
	countries := make([]common.CountryCode, len(row.ServiceCountries))
	for index, value := range row.ServiceCountries {
		countries[index] = common.CountryCode(value)
	}
	languages := make([]common.LanguageTag, len(row.Languages))
	for index, value := range row.Languages {
		languages[index] = common.LanguageTag(value)
	}
	listing := marketplace.Listing{
		Capability: marketplace.Capability(row.CapabilityOid),
		State:      marketplace.ListingState(row.ListingState),
		Version:    marketplace.ListingVersion(row.Version),
		ListingContent: marketplace.ListingContent{
			Headline: row.Headline, Description: row.Description,
			Service: marketplace.ServiceArea{
				Worldwide: row.ServiceWorldwide, Countries: countries,
			},
			Languages: languages,
		},
		CreatedAt: row.CreatedAt.Time.UTC(),
		UpdatedAt: row.UpdatedAt.Time.UTC(),
	}
	if row.IndicativePrice.Valid {
		listing.IndicativePrice = &row.IndicativePrice.String
	}
	if row.ConsentDisclosure.Valid {
		listing.ConsentDisclosure = &row.ConsentDisclosure.String
	}
	if len(row.CheckTypes) > 0 {
		listing.CheckTypes = make([]hiring.CheckType, len(row.CheckTypes))
		for index, value := range row.CheckTypes {
			listing.CheckTypes[index] = hiring.CheckType(value)
		}
	}
	return listing
}

// contentArgs are the stored forms of a Listing's content. Slices are never
// nil: the columns are NOT NULL.
type contentArgs struct {
	countries, languages, checkTypes []string
}

func argsFrom(content marketplace.ListingContent) contentArgs {
	args := contentArgs{
		countries:  make([]string, len(content.Service.Countries)),
		languages:  make([]string, len(content.Languages)),
		checkTypes: make([]string, len(content.CheckTypes)),
	}
	for index, value := range content.Service.Countries {
		args.countries[index] = string(value)
	}
	for index, value := range content.Languages {
		args.languages[index] = string(value)
	}
	for index, value := range content.CheckTypes {
		args.checkTypes[index] = string(value)
	}
	return args
}

// locked runs work under the Org lock, which serializes it with other Listing
// writes and with a plan change. needPlan first refuses an Org whose plan does
// not allow Listings: creating, editing, and publishing need the entitlement;
// unlisting and deleting never do, so a downgraded Org can tidy up.
func locked[T any](
	r *http.Request, q *sqlc.Queries, orgDID pgtype.UUID, needPlan bool,
	work func() (handlerauth.Result[T], *handlerauth.Problem, error),
) (handlerauth.Result[T], *handlerauth.Problem, error) {
	row, err := q.LockOrgForListings(r.Context(), orgDID)
	if errors.Is(err, pgx.ErrNoRows) {
		return handlerauth.Failure[T](orgsproblem.OrgSuspendedError)
	}
	if err != nil {
		return handlerauth.Result[T]{}, nil, err
	}
	if needPlan &&
		!subscriptionspec.AllowsListings(subscriptionspec.Plan(row.OrgPlanOid)) {
		return handlerauth.Failure[T](orgsproblem.ListingPlanRequiredError)
	}
	return work()
}

// refusal names why a write that matched no row changed nothing. The caller
// holds the Org lock, so the Listing cannot change between the write and this
// read.
func refusal[T any](
	r *http.Request, q *sqlc.Queries, orgDID pgtype.UUID,
	capability marketplace.Capability, version marketplace.ListingVersion,
	stateConflict bool,
) (handlerauth.Result[T], *handlerauth.Problem, error) {
	row, err := q.GetOrgListing(r.Context(), sqlc.GetOrgListingParams{
		OrgDid: orgDID, CapabilityOid: string(capability),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return handlerauth.Failure[T](orgsproblem.ListingNotFoundError)
	}
	if err != nil {
		return handlerauth.Result[T]{}, nil, err
	}
	if row.Version != int32(version) {
		return handlerauth.Failure[T](orgsproblem.ListingVersionConflictError)
	}
	if !stateConflict {
		return handlerauth.Result[T]{}, nil,
			fmt.Errorf("listing write matched no row at its current version")
	}
	return handlerauth.Failure[T](orgsproblem.ListingStateConflictError)
}

func ListListings(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request marketplace.ListListingsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		rows, err := s.Queries.ListOrgListings(r.Context(), identity.OrgDID)
		if err != nil {
			s.InternalError(r.Context(), w, "list Listings", err)
			return
		}
		response := marketplace.ListListingsResponse{
			Listings: make([]marketplace.Listing, 0, len(rows)),
		}
		for _, row := range rows {
			response.Listings = append(
				response.Listings, listingFrom(sqlc.GetOrgListingRow(row)),
			)
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func CreateListing(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request marketplace.CreateListingRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[marketplace.Listing]
		handlerauth.RunIdempotent(s, w, r, "orgs:create-listing",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				return locked(r, q, identity.OrgDID, true, func() (result, *handlerauth.Problem, error) {
					id, err := dbvalue.NewUUIDv7(now)
					if err != nil {
						return result{}, nil, err
					}
					args := argsFrom(request.ListingContent)
					row, err := q.CreateOrgListing(r.Context(), sqlc.CreateOrgListingParams{
						ListingID: id, OrgDid: identity.OrgDID,
						CapabilityOid: string(request.Capability),
						Headline:      request.Headline, Description: request.Description,
						ServiceWorldwide: request.Service.Worldwide,
						ServiceCountries: args.countries, Languages: args.languages,
						IndicativePrice:   dbvalue.NullText(request.IndicativePrice),
						CheckTypes:        args.checkTypes,
						ConsentDisclosure: dbvalue.NullText(request.ConsentDisclosure),
						TenantID:          s.TenantID,
						ActorID:           dbvalue.FormatUUID(identity.UserID),
						IdempotencyKey:    dbvalue.Text(string(key)),
					})
					if err != nil {
						return result{}, nil, err
					}
					if row.CreatedRows == 0 {
						return handlerauth.Failure[marketplace.Listing](orgsproblem.ListingExistsError)
					}
					if row.CreatedRows != 1 || row.AuditRows != 1 {
						return result{}, nil, fmt.Errorf("incomplete Listing creation")
					}
					created, err := q.GetOrgListing(r.Context(), sqlc.GetOrgListingParams{
						OrgDid: identity.OrgDID, CapabilityOid: string(request.Capability),
					})
					if err != nil {
						return result{}, nil, err
					}
					return result{Status: http.StatusCreated, Body: listingFrom(created)}, nil, nil
				})
			})
	}
}

func UpdateListing(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request marketplace.UpdateListingRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[marketplace.Listing]
		handlerauth.RunIdempotent(s, w, r, "orgs:update-listing",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				return locked(r, q, identity.OrgDID, true, func() (result, *handlerauth.Problem, error) {
					args := argsFrom(request.ListingContent)
					row, err := q.UpdateOrgListing(r.Context(), sqlc.UpdateOrgListingParams{
						OrgDid: identity.OrgDID, CapabilityOid: string(request.Capability),
						Version:  int32(request.Version),
						Headline: request.Headline, Description: request.Description,
						ServiceWorldwide: request.Service.Worldwide,
						ServiceCountries: args.countries, Languages: args.languages,
						IndicativePrice:   dbvalue.NullText(request.IndicativePrice),
						CheckTypes:        args.checkTypes,
						ConsentDisclosure: dbvalue.NullText(request.ConsentDisclosure),
						TenantID:          s.TenantID,
						ActorID:           dbvalue.FormatUUID(identity.UserID),
						IdempotencyKey:    dbvalue.Text(string(key)),
					})
					if err != nil {
						return result{}, nil, err
					}
					if row.UpdatedRows == 0 {
						return refusal[marketplace.Listing](
							r, q, identity.OrgDID, request.Capability, request.Version, false,
						)
					}
					if row.UpdatedRows != 1 || row.AuditRows != 1 {
						return result{}, nil, fmt.Errorf("incomplete Listing update")
					}
					updated, err := q.GetOrgListing(r.Context(), sqlc.GetOrgListingParams{
						OrgDid: identity.OrgDID, CapabilityOid: string(request.Capability),
					})
					if err != nil {
						return result{}, nil, err
					}
					return result{Status: http.StatusOK, Body: listingFrom(updated)}, nil, nil
				})
			})
	}
}

// changeState serves publish and unlist: both move a Listing between states
// at a version the caller read.
func changeState(
	s *orgsruntime.Server, operation, auditAction string,
	to marketplace.ListingState, from []marketplace.ListingState, needPlan bool,
) http.HandlerFunc {
	fromStates := make([]string, len(from))
	for index, state := range from {
		fromStates[index] = string(state)
	}
	return func(w http.ResponseWriter, r *http.Request) {
		var request marketplace.ListingTarget
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[marketplace.Listing]
		handlerauth.RunIdempotent(s, w, r, operation,
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				return locked(r, q, identity.OrgDID, needPlan, func() (result, *handlerauth.Problem, error) {
					row, err := q.SetOrgListingState(r.Context(), sqlc.SetOrgListingStateParams{
						NewState: sqlc.VetchiumOrgListingState(to),
						OrgDid:   identity.OrgDID, CapabilityOid: string(request.Capability),
						Version: int32(request.Version), FromStates: fromStates,
						TenantID: s.TenantID, AuditAction: auditAction,
						ActorID:        dbvalue.FormatUUID(identity.UserID),
						IdempotencyKey: dbvalue.Text(string(key)),
					})
					if err != nil {
						return result{}, nil, err
					}
					if row.ChangedRows == 0 {
						return refusal[marketplace.Listing](
							r, q, identity.OrgDID, request.Capability, request.Version, true,
						)
					}
					if row.ChangedRows != 1 || row.AuditRows != 1 {
						return result{}, nil, fmt.Errorf("incomplete Listing state change")
					}
					changed, err := q.GetOrgListing(r.Context(), sqlc.GetOrgListingParams{
						OrgDid: identity.OrgDID, CapabilityOid: string(request.Capability),
					})
					if err != nil {
						return result{}, nil, err
					}
					return result{Status: http.StatusOK, Body: listingFrom(changed)}, nil, nil
				})
			})
	}
}

func PublishListing(s *orgsruntime.Server) http.HandlerFunc {
	return changeState(s, "orgs:publish-listing", "org.listing.listed",
		marketplace.ListedListing,
		[]marketplace.ListingState{marketplace.DraftListing, marketplace.UnlistedListing},
		true)
}

func UnlistListing(s *orgsruntime.Server) http.HandlerFunc {
	return changeState(s, "orgs:unlist-listing", "org.listing.unlisted",
		marketplace.UnlistedListing,
		[]marketplace.ListingState{marketplace.ListedListing}, false)
}

func DeleteListing(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request marketplace.ListingTarget
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[struct{}]
		handlerauth.RunIdempotent(s, w, r, "orgs:delete-listing",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				return locked(r, q, identity.OrgDID, false, func() (result, *handlerauth.Problem, error) {
					row, err := q.DeleteOrgListing(r.Context(), sqlc.DeleteOrgListingParams{
						OrgDid: identity.OrgDID, CapabilityOid: string(request.Capability),
						Version: int32(request.Version), TenantID: s.TenantID,
						ActorID:        dbvalue.FormatUUID(identity.UserID),
						IdempotencyKey: dbvalue.Text(string(key)),
					})
					if err != nil {
						return result{}, nil, err
					}
					if row.DeletedRows == 0 {
						return refusal[struct{}](
							r, q, identity.OrgDID, request.Capability, request.Version, true,
						)
					}
					if row.DeletedRows != 1 || row.AuditRows != 1 {
						return result{}, nil, fmt.Errorf("incomplete Listing deletion")
					}
					return result{Status: http.StatusNoContent}, nil, nil
				})
			})
	}
}
