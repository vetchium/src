// Package agencyconversations is the agency tenant's side of what a Hub user
// does in an agency conversation: the reply and delete commands, and the
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
	registry.Register(federationspec.HubConversationDeleteKind, handleDelete, HubUserInitiator)
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

// conversation finds the agency's conversation with the commanding Hub user,
// locking the Contact. Another person's Contact answers as unknown: the
// authority authorizes what it owns (MKT-DAT-001).
func conversation(
	ctx context.Context, q *sqlc.Queries, orgDID, contactID, hubDID pgtype.UUID,
) (sqlc.VetchiumOrgConversation, bool, error) {
	if ok, err := lockContact(ctx, q, orgDID, contactID, hubDID); !ok || err != nil {
		return sqlc.VetchiumOrgConversation{}, false, err
	}
	row, err := q.GetOrgConversation(ctx, sqlc.GetOrgConversationParams{
		OrgDid: orgDID, ContactID: contactID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.VetchiumOrgConversation{}, false, nil
	}
	if err != nil {
		return sqlc.VetchiumOrgConversation{}, false, fmt.Errorf("read conversation: %w", err)
	}
	return row, true, nil
}

// lockContact locks the agency's Contact of the commanding Hub user; another
// person's Contact answers as unknown (MKT-DAT-001).
func lockContact(
	ctx context.Context, q *sqlc.Queries, orgDID, contactID, hubDID pgtype.UUID,
) (bool, error) {
	contact, err := q.LockOrgContact(ctx, sqlc.LockOrgContactParams{
		OrgDid: orgDID, ContactID: contactID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("lock Contact: %w", err)
	}
	return contact.HubUserDid == hubDID, nil
}

func handleReply(ctx context.Context, tx pgx.Tx, command commands.Command) (commands.Result, error) {
	var payload federationspec.HubConversationReplyPayload
	if rejected := decode(command, &payload, func() string {
		return string(payload.ContactID)
	}); rejected != nil {
		return *rejected, nil
	}
	contactID, err := dbvalue.ParseUUID(string(payload.ContactID))
	if err != nil {
		return commands.Result{}, err
	}
	hubDID, err := dbvalue.ParseUUID(string(payload.HubUserDID))
	if err != nil {
		return commands.Result{}, err
	}
	q := sqlc.New(tx)
	name, handle := string(payload.HubUserDisplayName), string(payload.HubUserHandle)
	window := pgtype.Int8{Int64: payload.WindowSeconds, Valid: true}
	if ok, err := lockContact(ctx, q, command.Authority.DID, contactID, hubDID); err != nil {
		return commands.Result{}, err
	} else if !ok {
		return commands.Rejected(hubproblem.HubConversationNotFoundError), nil
	}
	// Replying to the agency's pending request accepts it first (MKT-REQ-005).
	pending, err := q.GetPendingOrgChatRequest(ctx, contactID)
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
		OrgDid: command.Authority.DID, ContactID: contactID,
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
	messageID, err := dbvalue.NewUUID()
	if err != nil {
		return commands.Result{}, err
	}
	row, err := q.AddOrgConversationMessage(ctx, sqlc.AddOrgConversationMessageParams{
		MessageID: messageID, ConversationID: found.ConversationID,
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
	if row.ConversationRows != 1 || row.ContactRows != 1 || row.AuditRows != 1 {
		return commands.Result{}, fmt.Errorf("incomplete reply")
	}
	if rows, err := q.SetConversationActivity(ctx, sqlc.SetConversationActivityParams{
		ConversationID: found.ConversationID, HubActivityAt: row.SentAt,
		WindowSeconds: window,
	}); err != nil || rows != 1 {
		return commands.Result{}, fmt.Errorf("record activity: %d rows, %w", rows, err)
	}
	if _, err := q.RefreshOrgContactNamesFromHubUser(ctx,
		sqlc.RefreshOrgContactNamesFromHubUserParams{
			ContactID: contactID, OrgDid: command.Authority.DID,
			DisplayName: name, Handle: handle,
		}); err != nil {
		return commands.Result{}, fmt.Errorf("refresh Contact names: %w", err)
	}
	if err := agencycontacts.SyncPointer(ctx, q, command.Authority.DID, contactID, agencycontacts.NoNotice); err != nil {
		return commands.Result{}, err
	}
	result := contacts.ConversationMessage{
		MessageID:         contacts.MessageID(dbvalue.FormatUUID(row.MessageID)),
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

// handleDelete deletes the conversation for both sides (MKT-CNV-007). The
// Contact stays while it has notes; one with nothing left goes in the same
// transaction (MKT-CON-004).
func handleDelete(ctx context.Context, tx pgx.Tx, command commands.Command) (commands.Result, error) {
	var payload federationspec.HubConversationDeletePayload
	if rejected := decode(command, &payload, func() string {
		return string(payload.ContactID)
	}); rejected != nil {
		return *rejected, nil
	}
	contactID, err := dbvalue.ParseUUID(string(payload.ContactID))
	if err != nil {
		return commands.Result{}, err
	}
	hubDID, err := dbvalue.ParseUUID(string(payload.HubUserDID))
	if err != nil {
		return commands.Result{}, err
	}
	q := sqlc.New(tx)
	if _, ok, err := conversation(ctx, q, command.Authority.DID, contactID, hubDID); err != nil {
		return commands.Result{}, err
	} else if !ok {
		return commands.Rejected(hubproblem.HubConversationNotFoundError), nil
	}
	key := dbvalue.Text(dbvalue.FormatUUID(command.CommandID))
	deleted, err := q.DeleteOrgConversationForHubUser(ctx,
		sqlc.DeleteOrgConversationForHubUserParams{
			OrgDid: command.Authority.DID, ContactID: contactID,
			HubUserDid: hubDID, TenantID: command.TenantID, IdempotencyKey: key,
		})
	if err != nil {
		return commands.Result{}, fmt.Errorf("delete conversation: %w", err)
	}
	if deleted.AuditRows != 1 {
		return commands.Result{}, fmt.Errorf("incomplete conversation deletion")
	}
	gone, err := q.DeleteUnusedOrgContact(ctx, sqlc.DeleteUnusedOrgContactParams{
		ContactID: contactID, OrgDid: command.Authority.DID,
		TenantID: command.TenantID, ActorType: "hub_user",
		ActorID: dbvalue.FormatUUID(hubDID), Source: "federation-command",
		IdempotencyKey: key,
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		err = agencycontacts.SyncPointer(ctx, q, command.Authority.DID, contactID, agencycontacts.NoNotice)
	case err != nil:
		return commands.Result{}, fmt.Errorf("delete unused Contact: %w", err)
	default:
		err = agencycontacts.RemovePointer(ctx, q, command.Authority.DID,
			contactID, hubDID, gone.PointerVersion)
	}
	if err != nil {
		return commands.Result{}, err
	}
	return commands.Succeeded(http.StatusOK, struct{}{}), nil
}
