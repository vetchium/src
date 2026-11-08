package agencyconversations

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/agencycontacts"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
)

// handleChatRequest records a Hub user's request to the agency about a
// client's Opening (MKT-REQ-002, MKT-DAT-014). The Hub user's tenant read
// the assignment from the client's tenant; this tenant requires the active
// sourcing engagement it knows. The Contact it creates has no creator and
// does not count toward the agency's daily Contacts (MKT-CON-005).
func handleChatRequest(ctx context.Context, tx pgx.Tx, command commands.Command) (commands.Result, error) {
	var payload federationspec.HubChatRequestPayload
	if rejected := decode(command, &payload, func() string {
		return pairAggregate(payload.AgencyOrgDID, payload.HubUserDID)()
	}); rejected != nil {
		return *rejected, nil
	}
	hubDID, rejected, err := commandPair(command, payload.AgencyOrgDID, payload.HubUserDID)
	if rejected != nil || err != nil {
		return orResult(rejected), err
	}
	orgDID := command.Authority.DID
	q := sqlc.New(tx)
	if _, err := q.GetActiveSourcingEngagementWithClient(ctx,
		sqlc.GetActiveSourcingEngagementWithClientParams{
			ProviderOrgDid: orgDID, ConsumerDomain: string(payload.ConsumerDomain),
		}); errors.Is(err, pgx.ErrNoRows) {
		return commands.Rejected(hubproblem.HubAgencyNotAssignedError), nil
	} else if err != nil {
		return commands.Result{}, fmt.Errorf("find sourcing engagement: %w", err)
	}

	if _, err := q.LockOrgForContacts(ctx, orgDID); err != nil {
		return commands.Result{}, fmt.Errorf("lock Org: %w", err)
	}
	name, handle := string(payload.HubUserDisplayName), string(payload.HubUserHandle)
	now := time.Now()
	idempotencyKey := dbvalue.Text(dbvalue.FormatUUID(command.CommandID))
	_, err = q.LockOrgContact(ctx, sqlc.LockOrgContactParams{OrgDid: orgDID, HubUserDid: hubDID})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		created, err := q.CreateOrgContactForHubRequest(ctx, sqlc.CreateOrgContactForHubRequestParams{
			OrgDid: orgDID, HubUserDid: hubDID, DisplayName: name, Handle: handle,
			RequestsOff: payload.RequestsOff, TenantID: command.TenantID,
			Source: "federation-command", IdempotencyKey: idempotencyKey,
		})
		if err != nil {
			return commands.Result{}, fmt.Errorf("create Contact: %w", err)
		}
		if created.CreatedRows != 1 || created.AuditRows != 1 {
			return commands.Result{}, fmt.Errorf("incomplete Contact creation")
		}
	case err != nil:
		return commands.Result{}, fmt.Errorf("lock Contact: %w", err)
	default:
		if _, err := q.RefreshOrgContactNamesFromHubUser(ctx,
			sqlc.RefreshOrgContactNamesFromHubUserParams{
				OrgDid: orgDID, HubUserDid: hubDID, DisplayName: name,
			}); err != nil {
			return commands.Result{}, fmt.Errorf("refresh Contact names: %w", err)
		}
	}

	opening := contacts.OpeningSuggestion{
		ConsumerDomain: payload.ConsumerDomain, OpeningNumber: payload.OpeningNumber,
	}
	refusal, err := agencycontacts.Refuse(ctx, q, orgDID, hubDID, contacts.ToAgency, opening, now)
	if err != nil {
		return commands.Result{}, err
	}
	if refusal != agencycontacts.NotRefused {
		return commands.Rejected(hubRefusals[refusal]), nil
	}
	var note pgtype.Text
	if payload.Note != nil {
		note = dbvalue.Text(string(*payload.Note))
	}
	year, month, day := now.UTC().Date()
	created, err := q.CreateOrgChatRequest(ctx, sqlc.CreateOrgChatRequestParams{
		OrgDid: orgDID, HubUserDid: hubDID, Direction: string(contacts.ToAgency),
		ConsumerDomain: string(payload.ConsumerDomain),
		OpeningNumber:  int32(payload.OpeningNumber),
		Note:           note, SenderDisplayName: name,
		WindowSeconds: pgtype.Int8{Int64: payload.WindowSeconds, Valid: true},
		Day: pgtype.Date{
			Time: time.Date(year, month, day, 0, 0, 0, 0, time.UTC), Valid: true,
		},
		TenantID: command.TenantID, ActorType: "hub_user",
		ActorID: dbvalue.FormatUUID(hubDID), Source: "federation-command",
		IdempotencyKey: idempotencyKey,
	})
	if err != nil {
		return commands.Result{}, fmt.Errorf("create chat request: %w", err)
	}
	if created.CountedRows != 0 || created.AuditRows != 1 {
		return commands.Result{}, fmt.Errorf("incomplete chat request")
	}
	if err := agencycontacts.SyncPointer(ctx, q, orgDID, hubDID, agencycontacts.NoNotice); err != nil {
		return commands.Result{}, err
	}
	row, err := q.GetOrgChatRequest(ctx, sqlc.GetOrgChatRequestParams{
		OrgDid: orgDID, HubUserDid: hubDID, RequestNumber: created.RequestNumber,
	})
	if err != nil {
		return commands.Result{}, fmt.Errorf("read chat request: %w", err)
	}
	return commands.Succeeded(http.StatusOK, federationspec.HubChatRequestResult{
		Request: agencycontacts.PointerRequest(row.VetchiumOrgChatRequest),
	}), nil
}

// hubRefusals names each MKT-REQ-003 refusal of a Hub user's request with
// the Hub problem type.
var hubRefusals = map[agencycontacts.Refusal]problem.Details{
	agencycontacts.RefusedPartyDeleted:     hubproblem.HubConversationPartyDeletedError,
	agencycontacts.RefusedRequestPending:   hubproblem.HubChatRequestExistsError,
	agencycontacts.RefusedConversationOpen: hubproblem.HubConversationOpenError,
	agencycontacts.RefusedBlocked:          hubproblem.HubChatRequestBlockedError,
}

// handleChatRequestAnswer applies a Hub user's answer to an agency's request
// (MKT-REQ-005, MKT-REQ-007). It returns the answered request as the
// pointer keeps it.
func handleChatRequestAnswer(ctx context.Context, tx pgx.Tx, command commands.Command) (commands.Result, error) {
	var payload federationspec.HubChatRequestAnswerPayload
	if rejected := decode(command, &payload, func() string {
		return pairAggregate(payload.AgencyOrgDID, payload.HubUserDID)()
	}); rejected != nil {
		return *rejected, nil
	}
	hubDID, rejected, err := commandPair(command, payload.AgencyOrgDID, payload.HubUserDID)
	if rejected != nil || err != nil {
		return orResult(rejected), err
	}
	orgDID := command.Authority.DID
	q := sqlc.New(tx)

	if ok, err := lockContact(ctx, q, orgDID, hubDID); err != nil {
		return commands.Result{}, err
	} else if !ok {
		return commands.Rejected(hubproblem.HubChatRequestNotFoundError), nil
	}
	found, err := q.GetOrgChatRequest(ctx, sqlc.GetOrgChatRequestParams{
		OrgDid: orgDID, HubUserDid: hubDID, RequestNumber: int32(payload.RequestNumber),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return commands.Rejected(hubproblem.HubChatRequestNotFoundError), nil
	}
	if err != nil {
		return commands.Result{}, fmt.Errorf("read chat request: %w", err)
	}
	request := found.VetchiumOrgChatRequest
	if request.Direction != string(contacts.ToHubUser) ||
		request.State != string(contacts.ChatRequestPending) {
		return commands.Rejected(hubproblem.HubChatRequestNotFoundError), nil
	}

	name, handle := string(payload.HubUserDisplayName), string(payload.HubUserHandle)
	answer := agencycontacts.Answer{
		Accept:      payload.Accept,
		Window:      pgtype.Int8{Int64: payload.WindowSeconds, Valid: true},
		HubUserName: name, HubUserHandle: handle,
	}
	if payload.Scope != nil {
		answer.Scope = *payload.Scope
	}
	answered, err := agencycontacts.AnswerRequest(ctx, q, request, answer, hubAnswerer(command, hubDID))
	if errors.Is(err, agencycontacts.ErrConversationReadOnly) {
		return commands.Rejected(hubproblem.HubConversationPartyDeletedError), nil
	}
	if err != nil {
		return commands.Result{}, err
	}
	if _, err := q.RefreshOrgContactNamesFromHubUser(ctx,
		sqlc.RefreshOrgContactNamesFromHubUserParams{
			OrgDid: orgDID, HubUserDid: hubDID, DisplayName: name,
		}); err != nil {
		return commands.Result{}, fmt.Errorf("refresh Contact names: %w", err)
	}
	if err := agencycontacts.SyncPointer(ctx, q, orgDID, hubDID, agencycontacts.NoNotice); err != nil {
		return commands.Result{}, err
	}
	return commands.Succeeded(http.StatusOK, agencycontacts.PointerRequest(answered)), nil
}

// hubAnswerer audits a Hub user's command as theirs.
func hubAnswerer(command commands.Command, hubDID pgtype.UUID) agencycontacts.Answerer {
	return agencycontacts.Answerer{
		TenantID: command.TenantID, ActorType: "hub_user",
		ActorID: dbvalue.FormatUUID(hubDID), Source: "federation-command",
		IdempotencyKey: dbvalue.Text(dbvalue.FormatUUID(command.CommandID)),
	}
}
