package engagements

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/jackc/pgx/v5"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/events"
)

// ConsumerOrigin is the origin of engagement-changed: the consumer Org, the
// engagement's authority, which only its home tenant may report on.
func ConsumerOrigin(event events.Event) (events.Principal, bool) {
	var payload struct {
		Consumer struct {
			OrgDID string `json:"org_did"`
		} `json:"consumer"`
	}
	if json.Unmarshal(event.Payload, &payload) != nil {
		return events.Principal{}, false
	}
	did, err := dbvalue.ParseUUID(payload.Consumer.OrgDID)
	if err != nil {
		return events.Principal{}, false
	}
	return events.Principal{Type: directoryspec.PrincipalOrg, DID: did}, true
}

// Project writes the provider's projection row. The receiver calls it only
// for an event newer than the watermark, so it always overwrites. A payload
// that breaks the contract is an error, redelivered until fixed.
func Project(ctx context.Context, tx pgx.Tx, event events.Event) error {
	if event.Destination.Type != directoryspec.PrincipalOrg ||
		event.AggregateType != federationspec.EngagementAggregate {
		return fmt.Errorf("engagement-changed for %s %s",
			event.Destination.Type, event.AggregateType)
	}
	var snapshot federationspec.EngagementSnapshot
	decoder := json.NewDecoder(bytes.NewReader(event.Payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&snapshot); err != nil ||
		decoder.Decode(&struct{}{}) != io.EOF {
		return fmt.Errorf("decode engagement-changed payload: %v", err)
	}
	if fields := snapshot.Validate(); len(fields) > 0 {
		return fmt.Errorf("invalid engagement-changed payload: %v", fields)
	}
	providerDID, err := dbvalue.ParseUUID(string(snapshot.Provider.OrgDID))
	if err != nil {
		return err
	}
	if providerDID != event.Destination.DID ||
		event.AggregateID != string(snapshot.EngagementID) ||
		event.AggregateVersion != int64(snapshot.Version) {
		return fmt.Errorf("engagement-changed envelope does not match its payload")
	}
	id, err := dbvalue.ParseUUID(string(snapshot.EngagementID))
	if err != nil {
		return err
	}
	consumerDID, err := dbvalue.ParseUUID(string(snapshot.Consumer.OrgDID))
	if err != nil {
		return err
	}
	params := sqlc.UpsertOrgEngagementProjectionParams{
		EngagementID: id, ProviderOrgDid: providerDID,
		Version: int32(snapshot.Version), ConsumerOrgDid: consumerDID,
		ConsumerDomain:      string(snapshot.Consumer.Domain),
		ConsumerDisplayName: snapshot.Consumer.DisplayName,
		ProviderDomain:      string(snapshot.Provider.Domain),
		ProviderDisplayName: snapshot.Provider.DisplayName,
		CapabilityOid:       string(snapshot.Capability),
		EngagementState:     sqlc.VetchiumOrgEngagementState(snapshot.State),
		Message:             dbvalue.NullText(snapshot.Message),
		ConsumerReference:   dbvalue.NullText(snapshot.ConsumerReference),
		ProviderReference:   dbvalue.NullText(snapshot.ProviderReference),
		EndNote:             dbvalue.NullText(snapshot.EndNote),
		ProposedAt:          dbvalue.Timestamp(snapshot.ProposedAt),
		ExpiresAt:           dbvalue.Timestamp(snapshot.ExpiresAt),
		UpdatedAt:           dbvalue.Timestamp(snapshot.UpdatedAt),
	}
	if snapshot.EndedBy != nil {
		params.EndedBy = sqlc.NullVetchiumOrgEngagementParty{
			VetchiumOrgEngagementParty: sqlc.VetchiumOrgEngagementParty(*snapshot.EndedBy),
			Valid:                      true,
		}
	}
	if snapshot.DecidedAt != nil {
		params.DecidedAt = dbvalue.Timestamp(*snapshot.DecidedAt)
	}
	if snapshot.EndedAt != nil {
		params.EndedAt = dbvalue.Timestamp(*snapshot.EndedAt)
	}
	if _, err := sqlc.New(tx).UpsertOrgEngagementProjection(ctx, params); err != nil {
		return fmt.Errorf("project engagement: %w", err)
	}
	return nil
}
