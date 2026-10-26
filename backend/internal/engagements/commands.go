package engagements

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
	"backend/internal/federation/events"
)

// Register adds the four provider commands to registry. The consumer's tenant
// executes them as the engagement's authority.
func Register(registry *commands.Registry) {
	registry.Register(federationspec.EngagementAcceptKind, decide(true), Provider)
	registry.Register(federationspec.EngagementDeclineKind, decide(false), Provider)
	registry.Register(federationspec.EngagementEndKind, end, Provider)
	registry.Register(federationspec.EngagementSetReferenceKind, setReference, Provider)
}

// RegisterEvents adds the projection event to registry.
func RegisterEvents(registry *events.Registry) {
	registry.Register(federationspec.EngagementChangedKind, Project, ConsumerOrigin)
}

// Provider is the initiator of every engagement command: the provider Org the
// payload names, which alone may act for the provider side.
func Provider(command commands.Command) (commands.Principal, bool) {
	var payload struct {
		ProviderOrgDID string `json:"provider_org_did"`
	}
	if json.Unmarshal(command.Payload, &payload) != nil {
		return commands.Principal{}, false
	}
	did, err := dbvalue.ParseUUID(payload.ProviderOrgDID)
	if err != nil {
		return commands.Principal{}, false
	}
	return commands.Principal{Type: directoryspec.PrincipalOrg, DID: did}, true
}

type change struct {
	engagementID marketplace.EngagementID
	actor        federationspec.EngagementActorPayload
	params       sqlc.ChangeOrgEngagementParams
}

// apply runs one audited change as the provider's command and answers with
// the new snapshot, or with the deterministic refusal. The snapshot is also
// reported to the provider's tenant through the outbox.
func apply(
	ctx context.Context, tx pgx.Tx, command commands.Command, c change,
) (commands.Result, error) {
	engagementID, err := dbvalue.ParseUUID(string(c.engagementID))
	if err != nil {
		return commands.Result{}, err
	}
	if command.AggregateID != string(c.engagementID) {
		details := problem.ValidationFailedError
		details.Fields = []string{"aggregate_id"}
		return commands.Rejected(details), nil
	}
	providerDID, err := dbvalue.ParseUUID(string(c.actor.ProviderOrgDID))
	if err != nil {
		return commands.Result{}, err
	}
	q := sqlc.New(tx)
	params := c.params
	params.EngagementID = engagementID
	params.ConsumerOrgDid = command.Authority.DID
	params.ProviderOrgDid = providerDID
	params.Version = int32(c.actor.Version)
	params.TenantID = command.TenantID
	params.ActorType = "cross_tenant_caller"
	params.ActorID = string(c.actor.ProviderOrgDID)
	params.Source = "federation-command"
	params.IdempotencyKey = dbvalue.Text(dbvalue.FormatUUID(command.CommandID))
	params.ActorDisplayName = dbvalue.Text(c.actor.ActorDisplayName)
	params.SourceTenantID = dbvalue.Text(command.SourceTenantID)
	params.ProviderDisplayName = dbvalue.Text(c.actor.ProviderDisplayName)
	changed, err := q.ChangeOrgEngagement(ctx, params)
	if err != nil {
		return commands.Result{}, fmt.Errorf("change engagement: %w", err)
	}
	if changed.ChangedRows == 0 {
		details, err := Refusal(ctx, q, engagementID, command.Authority.DID,
			&providerDID, params.Version)
		if err != nil {
			return commands.Result{}, err
		}
		return commands.Rejected(details), nil
	}
	if changed.ChangedRows != 1 || changed.AuditRows != 1 {
		return commands.Result{}, fmt.Errorf("incomplete engagement change")
	}
	if params.NewState.Valid &&
		params.NewState.VetchiumOrgEngagementState == sqlc.VetchiumOrgEngagementStateEnded {
		if err := EndAccess(ctx, q, engagementID); err != nil {
			return commands.Result{}, err
		}
	}
	snapshot, err := EnqueueChange(ctx, q, engagementID)
	if err != nil {
		return commands.Result{}, err
	}
	return commands.Succeeded(http.StatusOK, snapshot), nil
}

func decide(accept bool) commands.Handler {
	state, action := sqlc.VetchiumOrgEngagementStateDeclined, "org.engagement.declined"
	if accept {
		state, action = sqlc.VetchiumOrgEngagementStateActive, "org.engagement.accepted"
	}
	return func(
		ctx context.Context, tx pgx.Tx, command commands.Command,
	) (commands.Result, error) {
		var body federationspec.EngagementDecisionPayload
		if rejected := commands.DecodeStrict(command, &body); rejected != nil {
			return *rejected, nil
		}
		return apply(ctx, tx, command, change{
			engagementID: body.EngagementID, actor: body,
			params: sqlc.ChangeOrgEngagementParams{
				NewState:    sqlc.NullVetchiumOrgEngagementState{VetchiumOrgEngagementState: state, Valid: true},
				SetDecided:  true,
				FromStates:  []string{string(marketplace.ProposedEngagement)},
				AuditAction: action,
			},
		})
	}
}

func end(
	ctx context.Context, tx pgx.Tx, command commands.Command,
) (commands.Result, error) {
	var body federationspec.EngagementEndPayload
	if rejected := commands.DecodeStrict(command, &body); rejected != nil {
		return *rejected, nil
	}
	params := sqlc.ChangeOrgEngagementParams{
		NewState: sqlc.NullVetchiumOrgEngagementState{
			VetchiumOrgEngagementState: sqlc.VetchiumOrgEngagementStateEnded, Valid: true,
		},
		EndedBy: sqlc.NullVetchiumOrgEngagementParty{
			VetchiumOrgEngagementParty: sqlc.VetchiumOrgEngagementPartyProvider, Valid: true,
		},
		EndNote:     dbvalue.NullText(body.Note),
		FromStates:  []string{string(marketplace.ActiveEngagement)},
		AuditAction: "org.engagement.ended",
	}
	return apply(ctx, tx, command, change{
		engagementID: body.EngagementID, actor: body.EngagementActorPayload,
		params: params,
	})
}

func setReference(
	ctx context.Context, tx pgx.Tx, command commands.Command,
) (commands.Result, error) {
	var body federationspec.EngagementReferencePayload
	if rejected := commands.DecodeStrict(command, &body); rejected != nil {
		return *rejected, nil
	}
	return apply(ctx, tx, command, change{
		engagementID: body.EngagementID, actor: body.EngagementActorPayload,
		params: sqlc.ChangeOrgEngagementParams{
			ReferenceParty: string(marketplace.ProviderParty),
			Reference:      dbvalue.NullText(body.Reference),
			FromStates:     AllStates(),
			AuditAction:    "org.engagement.reference_set",
		},
	})
}
