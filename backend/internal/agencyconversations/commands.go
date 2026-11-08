// Package agencyconversations is the agency tenant's side of what a Hub user
// does in an agency conversation: the reply and message-delete commands, and the
// live read of the conversation (agent-guides/marketplace.md, MKT-DAT-005).
package agencyconversations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/agencycontacts"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
)

func Register(registry *commands.Registry) {
	registry.Register(federationspec.HubConversationReplyKind, handleReply, HubUserInitiator)
	registry.Register(federationspec.HubConversationMessageDeleteKind, handleMessageDelete, HubUserInitiator)
	registry.Register(federationspec.HubChatRequestKind, handleChatRequest, HubUserInitiator)
	registry.Register(federationspec.HubChatRequestAnswerKind, handleChatRequestAnswer, HubUserInitiator)
}

// HubUserInitiator is the Hub user the payload names, who alone may act on
// their side of a conversation.
func HubUserInitiator(command commands.Command) (commands.Principal, bool) {
	var payload struct {
		HubUserDID string `json:"hub_user_did"`
	}
	if json.Unmarshal(command.Payload, &payload) != nil {
		return commands.Principal{}, false
	}
	did, err := dbvalue.ParseUUID(payload.HubUserDID)
	if err != nil {
		return commands.Principal{}, false
	}
	return commands.Principal{Type: directoryspec.PrincipalHubUser, DID: did}, true
}

// decode parses a payload strictly; a malformed one never succeeds, so it is
// a deterministic rejection. aggregate reads the aggregate id the payload
// names.
func decode[T interface{ Validate() []string }](
	command commands.Command, target T, aggregate func() string,
) *commands.Result {
	reject := func(fields ...string) *commands.Result {
		details := problem.ValidationFailedError
		details.Fields = fields
		result := commands.Rejected(details)
		return &result
	}
	decoder := json.NewDecoder(bytes.NewReader(command.Payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil ||
		decoder.Decode(&struct{}{}) != io.EOF {
		return reject("payload")
	}
	if command.Authority.Type != directoryspec.PrincipalOrg {
		return reject("authority_principal_type")
	}
	if fields := target.Validate(); len(fields) > 0 {
		return reject(fields...)
	}
	if command.AggregateID != aggregate() {
		return reject("aggregate_id")
	}
	return nil
}

// pairAggregate is the aggregate id of a command on the pair of the agency
// and the Hub user its payload names.
func pairAggregate(agency orgs.OrgDID, hubUser hub.HubUserDID) func() string {
	return func() string { return federationspec.ContactAggregateID(agency, hubUser) }
}

// commandPair is the pair a command names: the agency must be the command's
// authority, which authorizes only what it owns (MKT-DAT-001).
func commandPair(
	command commands.Command, agency orgs.OrgDID, hubUser hub.HubUserDID,
) (pgtype.UUID, *commands.Result, error) {
	if string(agency) != dbvalue.FormatUUID(command.Authority.DID) {
		details := problem.ValidationFailedError
		details.Fields = []string{"agency_org_did"}
		result := commands.Rejected(details)
		return pgtype.UUID{}, &result, nil
	}
	hubDID, err := dbvalue.ParseUUID(string(hubUser))
	return hubDID, nil, err
}

// lockContact locks the agency's Contact of the commanding Hub user.
func lockContact(ctx context.Context, q *sqlc.Queries, orgDID, hubDID pgtype.UUID) (bool, error) {
	_, err := q.LockOrgContact(ctx, sqlc.LockOrgContactParams{OrgDid: orgDID, HubUserDid: hubDID})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("lock Contact: %w", err)
	}
	return true, nil
}

func handleReply(ctx context.Context, tx pgx.Tx, command commands.Command) (commands.Result, error) {
	var payload federationspec.HubConversationReplyPayload
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
	name, handle := string(payload.HubUserDisplayName), string(payload.HubUserHandle)
	window := pgtype.Int8{Int64: payload.WindowSeconds, Valid: true}
	if ok, err := lockContact(ctx, q, orgDID, hubDID); err != nil {
		return commands.Result{}, err
	} else if !ok {
		return commands.Rejected(hubproblem.HubConversationNotFoundError), nil
	}
	// Replying to the agency's pending request accepts it first (MKT-REQ-005).
	pending, err := q.GetPendingOrgChatRequest(ctx, sqlc.GetPendingOrgChatRequestParams{
		OrgDid: orgDID, HubUserDid: hubDID,
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return commands.Result{}, fmt.Errorf("read pending chat request: %w", err)
	case pending.VetchiumOrgChatRequest.Direction == string(contacts.ToHubUser):
		_, err := agencycontacts.AnswerRequest(ctx, q, pending.VetchiumOrgChatRequest,
			agencycontacts.Answer{
				Accept: true, Window: window, HubUserName: name, HubUserHandle: handle,
			}, hubAnswerer(command, hubDID))
		if errors.Is(err, agencycontacts.ErrConversationReadOnly) {
			return commands.Rejected(hubproblem.HubConversationPartyDeletedError), nil
		}
		if err != nil {
			return commands.Result{}, err
		}
	}
	found, err := q.GetOrgConversation(ctx, sqlc.GetOrgConversationParams{
		OrgDid: orgDID, HubUserDid: hubDID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return commands.Rejected(hubproblem.HubConversationNotFoundError), nil
	}
	if err != nil {
		return commands.Result{}, fmt.Errorf("read conversation: %w", err)
	}
	switch {
	case found.ReadOnlyReason.Valid:
		return commands.Rejected(hubproblem.HubConversationPartyDeletedError), nil
	// The command's window applies from now on (MKT-REQ-004).
	case !agencycontacts.Window(found.HubActivityAt, found.AgencyActivityAt, window).
		HubMayWrite(time.Now()):
		return commands.Rejected(hubproblem.HubConversationClosedError), nil
	}
	row, err := q.AddOrgConversationMessage(ctx, sqlc.AddOrgConversationMessageParams{
		OrgDid: orgDID, HubUserDid: hubDID,
		SenderType:        string(contacts.MessageSenderTypeHubUser),
		SenderDisplayName: name, Kind: string(contacts.MessageKindText),
		MessageText:   dbvalue.Text(string(payload.Text)),
		HubUserName:   dbvalue.Text(name),
		HubUserHandle: dbvalue.Text(handle),
		TenantID:      command.TenantID, ActorType: "hub_user",
		ActorID: dbvalue.FormatUUID(hubDID), Source: "federation-command",
		IdempotencyKey: dbvalue.Text(dbvalue.FormatUUID(command.CommandID)),
	})
	if err != nil {
		return commands.Result{}, fmt.Errorf("add reply: %w", err)
	}
	if row.ContactRows != 1 || row.AuditRows != 1 {
		return commands.Result{}, fmt.Errorf("incomplete reply")
	}
	if rows, err := q.SetConversationActivity(ctx, sqlc.SetConversationActivityParams{
		OrgDid: orgDID, HubUserDid: hubDID, HubActivityAt: row.SentAt,
		WindowSeconds: window,
	}); err != nil || rows != 1 {
		return commands.Result{}, fmt.Errorf("record activity: %d rows, %w", rows, err)
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
	result := contacts.ConversationMessage{
		MessageNumber:     contacts.MessageNumber(row.MessageNumber),
		SenderType:        contacts.MessageSenderType(row.SenderType),
		SenderDisplayName: row.SenderDisplayName,
		Kind:              contacts.MessageKind(row.Kind),
		SentAt:            row.SentAt.Time.UTC(),
	}
	if row.MessageText.Valid {
		text := contacts.MessageText(row.MessageText.String)
		result.Text = &text
	}
	return commands.Succeeded(http.StatusOK, result), nil
}

// handleMessageDelete deletes one of the Hub user's own messages
// (MKT-CNV-007). The agency keeps a "Message deleted" stub and an audit
// without the text: only the Hub user's tenant keeps what they wrote.
func handleMessageDelete(ctx context.Context, tx pgx.Tx, command commands.Command) (commands.Result, error) {
	var payload federationspec.HubConversationMessageDeletePayload
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
		return commands.Rejected(hubproblem.HubConversationMessageNotFoundError), nil
	}
	deleted, err := q.DeleteOrgConversationMessage(ctx, sqlc.DeleteOrgConversationMessageParams{
		OrgDid: orgDID, HubUserDid: hubDID,
		MessageNumber: int32(payload.MessageNumber),
		SenderType:    string(contacts.MessageSenderTypeHubUser),
		TenantID:      command.TenantID, ActorType: "hub_user",
		ActorID: dbvalue.FormatUUID(hubDID), Source: "federation-command",
		IdempotencyKey: dbvalue.Text(dbvalue.FormatUUID(command.CommandID)),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return commands.Rejected(hubproblem.HubConversationMessageNotFoundError), nil
	}
	if err != nil {
		return commands.Result{}, fmt.Errorf("delete message: %w", err)
	}
	if deleted.AuditRows != 1 {
		return commands.Result{}, fmt.Errorf("incomplete message deletion")
	}
	return commands.Succeeded(http.StatusOK, agencycontacts.DeletedMessage(deleted)), nil
}

// orResult is the rejection commandPair returned, if any.
func orResult(rejected *commands.Result) commands.Result {
	if rejected == nil {
		return commands.Result{}
	}
	return *rejected
}
