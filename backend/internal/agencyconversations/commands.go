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
// a deterministic rejection. The aggregate is the Contact.
func decode[T interface{ Validate() []string }](
	command commands.Command, target T, contactID func() contacts.ContactID,
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
	if command.AggregateID != string(contactID()) {
		return reject("aggregate_id")
	}
	return nil
}

// conversation finds the agency's conversation with the commanding Hub user,
// locking the Contact. Another person's Contact answers as unknown: the
// authority authorizes what it owns (MKT-DAT-001).
func conversation(
	ctx context.Context, q *sqlc.Queries, orgDID, contactID, hubDID pgtype.UUID,
) (sqlc.GetOrgConversationRow, bool, error) {
	contact, err := q.LockOrgContact(ctx, sqlc.LockOrgContactParams{
		OrgDid: orgDID, ContactID: contactID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.GetOrgConversationRow{}, false, nil
	}
	if err != nil {
		return sqlc.GetOrgConversationRow{}, false, fmt.Errorf("lock Contact: %w", err)
	}
	if contact.HubUserDid != hubDID {
		return sqlc.GetOrgConversationRow{}, false, nil
	}
	row, err := q.GetOrgConversation(ctx, sqlc.GetOrgConversationParams{
		OrgDid: orgDID, ContactID: contactID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.GetOrgConversationRow{}, false, nil
	}
	if err != nil {
		return sqlc.GetOrgConversationRow{}, false, fmt.Errorf("read conversation: %w", err)
	}
	return row, true, nil
}

func handleReply(ctx context.Context, tx pgx.Tx, command commands.Command) (commands.Result, error) {
	var payload federationspec.HubConversationReplyPayload
	if rejected := decode(command, &payload, func() contacts.ContactID {
		return payload.ContactID
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
	found, ok, err := conversation(ctx, q, command.Authority.DID, contactID, hubDID)
	if err != nil {
		return commands.Result{}, err
	}
	if !ok {
		return commands.Rejected(hubproblem.HubConversationNotFoundError), nil
	}
	switch {
	case found.ReadOnlyReason.Valid:
		return commands.Rejected(hubproblem.HubConversationPartyDeletedError), nil
	case found.MessagesOff:
		return commands.Rejected(hubproblem.HubAgencyMessagesOffError), nil
	}
	messageID, err := dbvalue.NewUUID()
	if err != nil {
		return commands.Result{}, err
	}
	name, handle := string(payload.HubUserDisplayName), string(payload.HubUserHandle)
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
	if _, err := q.RefreshOrgContactNamesFromHubUser(ctx,
		sqlc.RefreshOrgContactNamesFromHubUserParams{
			ContactID: contactID, OrgDid: command.Authority.DID,
			DisplayName: name, Handle: handle,
		}); err != nil {
		return commands.Result{}, fmt.Errorf("refresh Contact names: %w", err)
	}
	if err := agencycontacts.SyncPointer(ctx, q, command.Authority.DID, contactID, false); err != nil {
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
	if rejected := decode(command, &payload, func() contacts.ContactID {
		return payload.ContactID
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
		err = agencycontacts.SyncPointer(ctx, q, command.Authority.DID, contactID, false)
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
