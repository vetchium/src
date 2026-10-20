// Package engagements is the engagement aggregate of the marketplace
// (agent-guides/marketplace.md, Engagements). The consumer's tenant is
// authoritative: it changes an engagement for its own users and for the
// provider's commands, and reports every change to the provider's tenant,
// which keeps a non-authoritative projection (MKT-GEN-004).
package engagements

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/events"
)

// Fields is the stored shape of an engagement, read from the consumer's view
// or the provider's projection. Both convert to it because they select the
// same columns.
type Fields = sqlc.VetchiumOrgEngagementSnapshot

// FromProjection converts a row of the provider's projection.
func FromProjection(row sqlc.GetProviderEngagementRow) Fields {
	return Fields(row)
}

// FromProjectionList converts a row of the provider's projection list.
func FromProjectionList(row sqlc.ListProviderEngagementsRow) Fields {
	return Fields(row)
}

func optionalText(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func optionalTime(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	utc := value.Time.UTC()
	return &utc
}

// Snapshot converts stored fields to the wire snapshot.
func Snapshot(row Fields) federationspec.EngagementSnapshot {
	snapshot := federationspec.EngagementSnapshot{
		EngagementID: marketplace.EngagementID(dbvalue.FormatUUID(row.EngagementID)),
		Version:      marketplace.EngagementVersion(row.Version),
		Consumer: federationspec.EngagementSnapshotOrg{
			OrgDID:      orgs.OrgDID(dbvalue.FormatUUID(row.ConsumerOrgDid)),
			Domain:      orgs.OrgDomain(row.ConsumerDomain),
			DisplayName: row.ConsumerDisplayName,
		},
		Provider: federationspec.EngagementSnapshotOrg{
			OrgDID:      orgs.OrgDID(dbvalue.FormatUUID(row.ProviderOrgDid)),
			Domain:      orgs.OrgDomain(row.ProviderDomain),
			DisplayName: row.ProviderDisplayName,
		},
		Capability:        marketplace.Capability(row.CapabilityOid),
		State:             marketplace.EngagementState(row.EngagementState),
		Message:           optionalText(row.Message),
		ConsumerReference: optionalText(row.ConsumerReference),
		ProviderReference: optionalText(row.ProviderReference),
		EndNote:           optionalText(row.EndNote),
		ProposedAt:        row.ProposedAt.Time.UTC(),
		ExpiresAt:         row.ExpiresAt.Time.UTC(),
		DecidedAt:         optionalTime(row.DecidedAt),
		EndedAt:           optionalTime(row.EndedAt),
		UpdatedAt:         row.UpdatedAt.Time.UTC(),
	}
	if row.EndedBy.Valid {
		party := marketplace.EngagementParty(row.EndedBy.VetchiumOrgEngagementParty)
		snapshot.EndedBy = &party
	}
	return snapshot
}

// EnqueueChange reports the engagement's current state to its provider's
// tenant and returns what it reported. Call it in every transaction that
// changes an engagement, after the change, beside that change's audit event.
func EnqueueChange(
	ctx context.Context, q sqlc.Querier, engagementID pgtype.UUID,
) (federationspec.EngagementSnapshot, error) {
	rows, err := q.GetOrgEngagementSnapshots(ctx, []pgtype.UUID{engagementID})
	if err != nil {
		return federationspec.EngagementSnapshot{}, fmt.Errorf("read engagement: %w", err)
	}
	if len(rows) != 1 {
		return federationspec.EngagementSnapshot{}, fmt.Errorf(
			"read %d engagements for one id", len(rows))
	}
	return enqueue(ctx, q, rows[0])
}

// EnqueueChanges is EnqueueChange for several engagements, read together.
func EnqueueChanges(
	ctx context.Context, q sqlc.Querier, engagementIDs []pgtype.UUID,
) error {
	rows, err := q.GetOrgEngagementSnapshots(ctx, engagementIDs)
	if err != nil {
		return fmt.Errorf("read engagements: %w", err)
	}
	if len(rows) != len(engagementIDs) {
		return fmt.Errorf("read %d of %d changed engagements",
			len(rows), len(engagementIDs))
	}
	for _, row := range rows {
		if _, err := enqueue(ctx, q, row); err != nil {
			return err
		}
	}
	return nil
}

func enqueue(
	ctx context.Context, q sqlc.Querier, row Fields,
) (federationspec.EngagementSnapshot, error) {
	snapshot := Snapshot(row)
	if fields := snapshot.Validate(); len(fields) > 0 {
		return snapshot, fmt.Errorf("invalid engagement snapshot: %v", fields)
	}
	if _, err := events.Enqueue(ctx, q, events.Outgoing{
		Kind: federationspec.EngagementChangedKind,
		Destination: events.Principal{
			Type: directoryspec.PrincipalOrg, DID: row.ProviderOrgDid,
		},
		AggregateType:    federationspec.EngagementAggregate,
		AggregateID:      string(snapshot.EngagementID),
		AggregateVersion: int64(row.Version),
		Payload:          snapshot,
	}); err != nil {
		return snapshot, err
	}
	return snapshot, nil
}

// EndAccess removes what the engagement granted the provider when it ends,
// in the ending transaction (MKT-ENG-004): its assignments, and with them
// every route, through which alone a provider reaches a candidacy.
func EndAccess(ctx context.Context, q sqlc.Querier, engagementID pgtype.UUID) error {
	if err := q.DeleteOrgEngagementAssignments(ctx, engagementID); err != nil {
		return fmt.Errorf("delete engagement assignments: %w", err)
	}
	return nil
}

var allStates = []string{
	string(marketplace.ProposedEngagement), string(marketplace.ActiveEngagement),
	string(marketplace.DeclinedEngagement), string(marketplace.WithdrawnEngagement),
	string(marketplace.ExpiredEngagement), string(marketplace.EndedEngagement),
}

// AllStates are the states a reference may be set in: any.
func AllStates() []string { return append([]string(nil), allStates...) }

// Refusal names why a change that matched no row changed nothing, as the
// problem to answer: the engagement does not involve the caller (unknown, or
// another party's), the caller read another version, or the state does not
// allow the action. providerDID is set when the caller is the provider.
func Refusal(
	ctx context.Context, q sqlc.Querier, engagementID, consumerDID pgtype.UUID,
	providerDID *pgtype.UUID, version int32,
) (problem.Details, error) {
	standing, err := q.GetOrgEngagementStanding(ctx, engagementID)
	if errors.Is(err, pgx.ErrNoRows) {
		return orgsproblem.EngagementNotFoundError, nil
	}
	if err != nil {
		return problem.Details{}, fmt.Errorf("read engagement standing: %w", err)
	}
	if standing.ConsumerOrgDid != consumerDID ||
		(providerDID != nil && standing.ProviderOrgDid != *providerDID) {
		return orgsproblem.EngagementNotFoundError, nil
	}
	if standing.Version != version {
		return orgsproblem.EngagementVersionConflictError, nil
	}
	return orgsproblem.EngagementStateConflictError, nil
}
