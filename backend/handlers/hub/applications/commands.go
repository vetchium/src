// Package applications serves the Hub user's applications: applying and
// withdrawing are durable commands to the Org's tenant
// (agent-guides/hiring-pipeline.md, HP-GEN-009); the list reads this
// tenant's projection and the detail reads the Org's tenant live.
package applications

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	operationspec "github.com/vetchium/src/typespec/hub/operations"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/openings"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
	hubruntime "backend/internal/hub"
)

var (
	errOrgNotFound    = errors.New("no Org holds the domain")
	errOrgUnavailable = errors.New("the directory did not resolve the domain")
)

// resolveOrg finds the Org holding domain: in this tenant first, then in the
// directory through the local relay.
func resolveOrg(
	ctx context.Context, s *hubruntime.Server, domain orgs.OrgDomain,
) (pgtype.UUID, error) {
	local, err := s.Queries.GetLocalOrgForDomain(ctx, string(domain))
	if err == nil {
		return local, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return pgtype.UUID{}, fmt.Errorf("read local Org domain: %w", err)
	}
	resolved, details, err := s.Directory.ResolveOrgDomain(ctx,
		directoryspec.ResolveOrgDomainRequest{Domain: domain})
	if err != nil {
		return pgtype.UUID{}, errOrgUnavailable
	}
	if details != nil {
		if details.Type == coordinatorproblem.DirectoryEntryNotFoundError.Type {
			return pgtype.UUID{}, errOrgNotFound
		}
		return pgtype.UUID{}, errOrgUnavailable
	}
	if resolved.Domain != domain {
		return pgtype.UUID{}, errOrgUnavailable
	}
	did, err := dbvalue.ParseUUID(string(resolved.OrgDID))
	if err != nil {
		return pgtype.UUID{}, errOrgUnavailable
	}
	return did, nil
}

// resolveOrgForWrite answers an unknown or unresolvable domain itself.
func resolveOrgForWrite(
	s *hubruntime.Server, w http.ResponseWriter, r *http.Request,
	domain orgs.OrgDomain, notFound problem.Details,
) (pgtype.UUID, bool) {
	orgDID, err := resolveOrg(r.Context(), s, domain)
	switch {
	case errors.Is(err, errOrgNotFound):
		s.Problem(r.Context(), w, notFound)
		return pgtype.UUID{}, false
	case errors.Is(err, errOrgUnavailable):
		s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
		return pgtype.UUID{}, false
	case err != nil:
		s.InternalError(r.Context(), w, "resolve Org domain", err)
		return pgtype.UUID{}, false
	}
	return orgDID, true
}

// requestDigest covers the caller's normalized request, so reusing its key
// for another request conflicts while the replayed snapshot may differ.
func requestDigest(request any) ([]byte, error) {
	data, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(data)
	return sum[:], nil
}

type commandRequest struct {
	kind      federationspec.CommandKind
	orgDID    pgtype.UUID
	opening   openings.OpeningNumber
	applicant pgtype.UUID
	key       common.IdempotencyKey
	digest    []byte
	payload   any
}

// sendCommand sends a Hub user's command about their own application to the
// Org's tenant and answers every outcome but a definite one, which it
// returns for the caller to write.
func sendCommand(
	s *hubruntime.Server, w http.ResponseWriter, r *http.Request,
	request commandRequest,
) (commands.Response, bool) {
	applicant := dbvalue.FormatUUID(request.applicant)
	outcome, err := s.Commands.Send(r.Context(), commands.Request{
		Kind: request.kind,
		Authority: commands.Principal{
			Type: directoryspec.PrincipalOrg, DID: request.orgDID,
		},
		AggregateID: strconv.Itoa(int(request.opening)),
		Owner: commands.Owner{
			Type: commands.OwnerHubUser, ID: applicant,
		},
		IdempotencyKey: request.key,
		RequestDigest:  request.digest,
		Payload:        request.payload,
	})
	if errors.Is(err, commands.ErrIdempotencyConflict) {
		s.Problem(r.Context(), w, problem.IdempotencyKeyConflictError)
		return commands.Response{}, false
	}
	if err != nil {
		s.InternalError(r.Context(), w, "send "+string(request.kind), err)
		return commands.Response{}, false
	}
	switch outcome.State {
	case commands.StateSucceeded, commands.StateFailed:
		return outcome.Response, true
	case commands.StatePending:
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusAccepted,
			operationspec.PendingOperation{
				OperationID: operationspec.OperationID(
					dbvalue.FormatUUID(outcome.OperationID),
				),
			})
	default:
		s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
	}
	return commands.Response{}, false
}

// writeRejection passes on a stored rejection the contract declares, mapped
// to its Hub problem; anything else is a fault between tenants.
func writeRejection(
	s *hubruntime.Server, w http.ResponseWriter, r *http.Request,
	response commands.Response, known map[string]problem.Details,
) {
	var details problem.Details
	if err := json.Unmarshal(response.Body, &details); err == nil {
		if mapped, ok := known[details.Type]; ok {
			s.Problem(r.Context(), w, mapped)
			return
		}
	}
	s.InternalError(r.Context(), w, "map federation command rejection",
		fmt.Errorf("unexpected rejection %d %s", response.Status,
			details.Type))
}
