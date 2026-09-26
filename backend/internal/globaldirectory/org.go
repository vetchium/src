package globaldirectory

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/dbvalue"
	"backend/internal/globaldb/sqlc"
)

const (
	reserveOrgOperation  = "global-directory.reserve-org-principal.v1"
	activateOrgOperation = "global-directory.activate-org-principal.v1"
	releaseOrgOperation  = "global-directory.release-org-domain.v1"
	claimOrgOperation    = "global-directory.claim-org-domain.v1"
)

type OrgOutcome struct {
	Status  int
	Org     *directoryspec.OrgPrincipalCommandResponse
	Problem *problem.Details
}

type orgMutation = mutation[directoryspec.OrgPrincipalCommandResponse]

func changedOrgMutation(
	response directoryspec.OrgPrincipalCommandResponse, version int64,
	auditAction, eventType string,
) orgMutation {
	return orgMutation{
		response: response, changed: true, directoryVersion: version,
		entityType: "org_principal", entityID: string(response.OrgDID),
		auditAction: auditAction, eventType: eventType,
	}
}

func (s *Service) orgCommand(
	ctx context.Context, caller directoryspec.TenantID, operation string,
	commandID directoryspec.CommandID, request any,
	work func(*sqlc.Queries) (orgMutation, *problem.Details, error),
) (OrgOutcome, error) {
	outcome, err := runCommand(
		ctx, s.pool, caller, operation, commandID, request, work,
	)
	return OrgOutcome{
		Status: outcome.status, Org: outcome.body, Problem: outcome.problem,
	}, err
}

func (s *Service) ResolveOrgDomain(
	ctx context.Context, domain orgs.OrgDomain,
) (directoryspec.ResolveOrgDomainResponse, error) {
	row, err := s.queries.ResolveOrgDomain(ctx, string(domain))
	if errors.Is(err, pgx.ErrNoRows) {
		return directoryspec.ResolveOrgDomainResponse{}, ErrNotFound
	}
	if err != nil {
		return directoryspec.ResolveOrgDomainResponse{}, fmt.Errorf(
			"resolve Org domain: %w", err,
		)
	}
	return directoryspec.ResolveOrgDomainResponse{
		OrgDID:         orgs.OrgDID(dbvalue.FormatUUID(row.OrgDid)),
		Domain:         orgs.OrgDomain(row.Domain),
		HomeTenantID:   directoryspec.TenantID(row.HomeTenantID),
		RoutingVersion: row.RoutingVersion,
	}, nil
}

func (s *Service) ReserveOrgPrincipal(
	ctx context.Context, caller directoryspec.TenantID,
	request directoryspec.ReserveOrgPrincipalRequest,
) (OrgOutcome, error) {
	return s.orgCommand(ctx, caller, reserveOrgOperation, request.CommandID,
		request,
		func(q *sqlc.Queries) (orgMutation, *problem.Details, error) {
			if request.HomeTenantID != caller {
				return orgMutation{}, details(
					coordinatorproblem.DirectoryCallerTenantMismatchError,
				), nil
			}
			did, _ := dbvalue.ParseUUID(string(request.OrgDID))
			commandID, _ := dbvalue.ParseUUID(string(request.CommandID))
			row, err := q.ReserveOrgPrincipal(
				ctx, sqlc.ReserveOrgPrincipalParams{
					OrgDid: did, HomeTenantID: string(request.HomeTenantID),
					CommandID: commandID,
					ProvisioningExpiresAt: dbvalue.Timestamp(
						request.ProvisioningExpiresAt,
					),
					Domain: string(request.Domain),
				},
			)
			if isUniqueViolation(err) {
				return orgMutation{}, details(
					coordinatorproblem.DirectoryClaimConflictError,
				), nil
			}
			if isConstraintViolation(
				err, "23514", "org_principals_state_check",
			) {
				return orgMutation{}, details(
					coordinatorproblem.DirectoryStateConflictError,
				), nil
			}
			if err != nil {
				return orgMutation{}, nil, fmt.Errorf(
					"reserve Org principal: %w", err,
				)
			}
			domain := pgtype.Text{String: row.Domain, Valid: true}
			return changedOrgMutation(
				orgResponse(
					row.OrgDid, domain, row.HomeTenantID,
					row.RoutingVersion, row.State,
				),
				row.DirectoryVersion,
				"global_directory.org_principal_reserved",
				"org_principal_reserved.v1",
			), nil, nil
		},
	)
}

func (s *Service) ActivateOrgPrincipal(
	ctx context.Context, caller directoryspec.TenantID,
	request directoryspec.ActivateOrgPrincipalRequest,
) (OrgOutcome, error) {
	return s.orgCommand(ctx, caller, activateOrgOperation, request.CommandID,
		request,
		func(q *sqlc.Queries) (orgMutation, *problem.Details, error) {
			did, _ := dbvalue.ParseUUID(string(request.OrgDID))
			principal, err := q.GetOrgPrincipal(ctx, did)
			if errors.Is(err, pgx.ErrNoRows) {
				return orgMutation{}, details(
					coordinatorproblem.DirectoryStateConflictError,
				), nil
			}
			if err != nil {
				return orgMutation{}, nil, fmt.Errorf(
					"get Org principal for activation: %w", err,
				)
			}
			if principal.HomeTenantID != string(caller) {
				return orgMutation{}, details(
					coordinatorproblem.DirectoryCallerTenantMismatchError,
				), nil
			}
			activated, err := q.ActivateOrgPrincipal(
				ctx, sqlc.ActivateOrgPrincipalParams{
					OrgDid: did, CallerTenantID: string(caller),
				},
			)
			if errors.Is(err, pgx.ErrNoRows) {
				return orgMutation{}, details(
					coordinatorproblem.DirectoryStateConflictError,
				), nil
			}
			if err != nil {
				return orgMutation{}, nil, fmt.Errorf(
					"activate Org principal: %w", err,
				)
			}
			response, err := orgCommandResponse(ctx, q, did)
			if err != nil {
				return orgMutation{}, nil, err
			}
			return changedOrgMutation(
				response, activated.DirectoryVersion,
				"global_directory.org_principal_activated",
				"org_principal_activated.v1",
			), nil, nil
		},
	)
}

func (s *Service) ReleaseOrgDomain(
	ctx context.Context, caller directoryspec.TenantID,
	request directoryspec.ReleaseOrgDomainRequest,
) (OrgOutcome, error) {
	return s.orgCommand(ctx, caller, releaseOrgOperation, request.CommandID,
		request,
		func(q *sqlc.Queries) (orgMutation, *problem.Details, error) {
			did, locked, rejection, err := lockActiveOrg(
				ctx, q, caller, request.OrgDID,
			)
			if rejection != nil || err != nil {
				return orgMutation{}, rejection, err
			}
			if !locked.Domain.Valid ||
				locked.Domain.String != string(request.Domain) {
				response, err := orgCommandResponse(ctx, q, did)
				return orgMutation{response: response}, nil, err
			}
			if _, err := q.DeleteOrgDomain(ctx, sqlc.DeleteOrgDomainParams{
				OrgDid: did, Domain: string(request.Domain),
			}); err != nil {
				return orgMutation{}, nil, fmt.Errorf(
					"delete Org domain: %w", err,
				)
			}
			return recordOrgDomainChange(
				ctx, q, did, "global_directory.org_domain_released",
				"org_domain_released.v1",
			)
		},
	)
}

func (s *Service) ClaimOrgDomain(
	ctx context.Context, caller directoryspec.TenantID,
	request directoryspec.ClaimOrgDomainRequest,
) (OrgOutcome, error) {
	return s.orgCommand(ctx, caller, claimOrgOperation, request.CommandID,
		request,
		func(q *sqlc.Queries) (orgMutation, *problem.Details, error) {
			did, locked, rejection, err := lockActiveOrg(
				ctx, q, caller, request.OrgDID,
			)
			if rejection != nil || err != nil {
				return orgMutation{}, rejection, err
			}
			if locked.Domain.Valid {
				if locked.Domain.String == string(request.Domain) {
					response, err := orgCommandResponse(ctx, q, did)
					return orgMutation{response: response}, nil, err
				}
				return orgMutation{}, details(
					coordinatorproblem.DirectoryStateConflictError,
				), nil
			}
			err = q.InsertOrgDomain(ctx, sqlc.InsertOrgDomainParams{
				Domain: string(request.Domain), OrgDid: did,
			})
			if isUniqueViolation(err) {
				return orgMutation{}, details(
					coordinatorproblem.DirectoryClaimConflictError,
				), nil
			}
			if err != nil {
				return orgMutation{}, nil, fmt.Errorf(
					"insert Org domain: %w", err,
				)
			}
			return recordOrgDomainChange(
				ctx, q, did, "global_directory.org_domain_claimed",
				"org_domain_claimed.v1",
			)
		},
	)
}

func lockActiveOrg(
	ctx context.Context, q *sqlc.Queries, caller directoryspec.TenantID,
	orgDID orgs.OrgDID,
) (pgtype.UUID, sqlc.LockOrgPrincipalRow, *problem.Details, error) {
	did, _ := dbvalue.ParseUUID(string(orgDID))
	locked, err := q.LockOrgPrincipal(ctx, did)
	if errors.Is(err, pgx.ErrNoRows) {
		return did, locked, details(
			coordinatorproblem.DirectoryStateConflictError,
		), nil
	}
	if err != nil {
		return did, locked, nil, fmt.Errorf("lock Org principal: %w", err)
	}
	if locked.HomeTenantID != string(caller) {
		return did, locked, details(
			coordinatorproblem.DirectoryCallerTenantMismatchError,
		), nil
	}
	if locked.State != sqlc.VetchiumGlobalPrincipalStateActive {
		return did, locked, details(
			coordinatorproblem.DirectoryStateConflictError,
		), nil
	}
	return did, locked, nil, nil
}

func recordOrgDomainChange(
	ctx context.Context, q *sqlc.Queries, did pgtype.UUID,
	auditAction, eventType string,
) (orgMutation, *problem.Details, error) {
	version, err := q.RecordOrgDomainChange(ctx, did)
	if err != nil {
		return orgMutation{}, nil, fmt.Errorf(
			"record Org domain change: %w", err,
		)
	}
	response, err := orgCommandResponse(ctx, q, did)
	if err != nil {
		return orgMutation{}, nil, err
	}
	return changedOrgMutation(response, version, auditAction, eventType),
		nil, nil
}

func orgCommandResponse(
	ctx context.Context, q *sqlc.Queries, did pgtype.UUID,
) (directoryspec.OrgPrincipalCommandResponse, error) {
	row, err := q.GetOrgPrincipalCommandView(ctx, did)
	if err != nil {
		return directoryspec.OrgPrincipalCommandResponse{}, fmt.Errorf(
			"read Org directory command response: %w", err,
		)
	}
	return orgResponse(
		row.OrgDid, row.Domain, row.HomeTenantID, row.RoutingVersion,
		row.State,
	), nil
}

func orgResponse(
	did pgtype.UUID, domain pgtype.Text, homeTenantID string,
	routingVersion int64, state sqlc.VetchiumGlobalPrincipalState,
) directoryspec.OrgPrincipalCommandResponse {
	response := directoryspec.OrgPrincipalCommandResponse{
		OrgDID:         orgs.OrgDID(dbvalue.FormatUUID(did)),
		HomeTenantID:   directoryspec.TenantID(homeTenantID),
		RoutingVersion: routingVersion,
		State:          directoryspec.PrincipalState(state),
	}
	if domain.Valid {
		value := orgs.OrgDomain(domain.String)
		response.Domain = &value
	}
	return response
}
