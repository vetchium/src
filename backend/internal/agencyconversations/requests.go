package agencyconversations

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/agencycontacts"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
)

// handleChatRequestAnswer applies a Hub user's answer to an agency's request
// (MKT-REQ-005, MKT-REQ-007). It returns the answered request as the
// pointer keeps it.
func handleChatRequestAnswer(ctx context.Context, tx pgx.Tx, command commands.Command) (commands.Result, error) {
	var payload federationspec.HubChatRequestAnswerPayload
	if rejected := decode(command, &payload, func() string {
		return string(payload.RequestID)
	}); rejected != nil {
		return *rejected, nil
	}
	requestID, err := dbvalue.ParseUUID(string(payload.RequestID))
	if err != nil {
		return commands.Result{}, err
	}
	contactID, err := dbvalue.ParseUUID(string(payload.ContactID))
	if err != nil {
		return commands.Result{}, err
	}
	hubDID, err := dbvalue.ParseUUID(string(payload.HubUserDID))
	if err != nil {
		return commands.Result{}, err
	}
	orgDID := command.Authority.DID
	q := sqlc.New(tx)

	if ok, err := lockContact(ctx, q, orgDID, contactID, hubDID); err != nil {
		return commands.Result{}, err
	} else if !ok {
		return commands.Rejected(hubproblem.HubChatRequestNotFoundError), nil
	}
	found, err := q.GetOrgChatRequest(ctx, sqlc.GetOrgChatRequestParams{
		OrgDid: orgDID, RequestID: requestID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return commands.Rejected(hubproblem.HubChatRequestNotFoundError), nil
	}
	if err != nil {
		return commands.Result{}, fmt.Errorf("read chat request: %w", err)
	}
	request := found.VetchiumOrgChatRequest
	if request.ContactID != contactID || request.HubUserDid != hubDID ||
		request.Direction != string(contacts.ToHubUser) ||
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
			ContactID: contactID, OrgDid: orgDID,
			DisplayName: name, Handle: handle,
		}); err != nil {
		return commands.Result{}, fmt.Errorf("refresh Contact names: %w", err)
	}
	if err := agencycontacts.SyncPointer(ctx, q, orgDID, contactID, agencycontacts.NoNotice); err != nil {
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
