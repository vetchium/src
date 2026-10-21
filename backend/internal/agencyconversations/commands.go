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
	registry.Register(federationspec.HubConversationDeleteKind, handleDelete, HubUserInitiator)
}

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

func decodePayload[T interface{ Validate() []string }](command commands.Command, target T) []string {
	decoder := json.NewDecoder(bytes.NewReader(command.Payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil || decoder.Decode(&struct{}{}) != io.EOF {
		return []string{"payload"}
	}
	return target.Validate()
}

func handleReply(ctx context.Context, tx pgx.Tx, command commands.Command) (commands.Result, error) {
	var payload federationspec.HubConversationReplyPayload
	if fields := decodePayload(command, &payload); len(fields) > 0 {
		details := problem.ValidationFailedError
		details.Fields = fields
		return commands.Rejected(details), nil
	}

	contactID, err := dbvalue.ParseUUID(string(payload.ContactID))
	if err != nil {
		return commands.Result{}, err
	}
	hubUserDID, err := dbvalue.ParseUUID(string(payload.HubUserDID))
	if err != nil {
		return commands.Result{}, err
	}

	q := sqlc.New(tx)
	contact, err := q.GetOrgContact(ctx, sqlc.GetOrgContactParams{
		OrgDid:    command.Authority.DID,
		ContactID: contactID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return commands.Rejected(hubproblem.HubConversationNotFoundError), nil
	}
	if err != nil {
		return commands.Result{}, fmt.Errorf("get contact: %w", err)
	}

	conversation, err := q.GetOrgConversationByContact(ctx, contactID)
	if errors.Is(err, pgx.ErrNoRows) {
		return commands.Rejected(hubproblem.HubConversationNotFoundError), nil
	}
	if err != nil {
		return commands.Result{}, fmt.Errorf("get conversation: %w", err)
	}

	if conversation.PartyDeletedAt.Valid ||
		(conversation.ReadOnlyReason.Valid && (conversation.ReadOnlyReason.String == "agency_deleted" || conversation.ReadOnlyReason.String == "hub_user_deleted")) {
		return commands.Rejected(hubproblem.HubConversationPartyDeletedError), nil
	}

	if contact.MessagesOff ||
		(conversation.ReadOnlyReason.Valid && conversation.ReadOnlyReason.String == "messages_off") {
		return commands.Rejected(hubproblem.HubAgencyMessagesOffError), nil
	}

	now := time.Now().UTC()
	messageID, err := dbvalue.NewUUIDv7(now)
	if err != nil {
		return commands.Result{}, err
	}

	msgRow, err := q.InsertOrgConversationMessage(ctx, sqlc.InsertOrgConversationMessageParams{
		MessageID:         messageID,
		ConversationID:    conversation.ConversationID,
		SenderType:        "hub_user",
		SenderUserID:      pgtype.UUID{},
		SenderDisplayName: contact.DisplayName,
		Kind:              "text",
		MessageText:       dbvalue.Text(string(payload.Text)),
		ConsumerDomain:    pgtype.Text{},
		OpeningNumber:     pgtype.Int4{},
		SentAt:            pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		return commands.Result{}, fmt.Errorf("insert message: %w", err)
	}

	if _, err := q.UpdateOrgConversationOnMessage(ctx, sqlc.UpdateOrgConversationOnMessageParams{
		ConversationID:       conversation.ConversationID,
		LastActivityAt:       pgtype.Timestamptz{Time: now, Valid: true},
		RecordedHubUserName:  contact.DisplayName,
		RecordedAgencyName:   conversation.RecordedAgencyName,
		RecordedAgencyDomain: conversation.RecordedAgencyDomain,
		AgencyUnread:         true,
	}); err != nil {
		return commands.Result{}, fmt.Errorf("update conversation on message: %w", err)
	}

	contactRow, err := q.TouchOrgContactPointer(ctx, sqlc.TouchOrgContactPointerParams{
		ContactID:      contactID,
		LastActivityAt: pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		return commands.Result{}, fmt.Errorf("touch contact pointer: %w", err)
	}
	newVersion := contactRow.PointerVersion

	// Audit event
	auditPayload, _ := json.Marshal(map[string]any{
		"action":     "message-sent",
		"message_id": dbvalue.FormatUUID(msgRow.MessageID),
	})
	if err := q.InsertAuditEvent(ctx, sqlc.InsertAuditEventParams{
		TenantID:          command.TenantID,
		Action:            "org.conversation.message-sent",
		EntityType:        "org_conversation",
		EntityID:          dbvalue.FormatUUID(conversation.ConversationID),
		ActorType:         "hub_user",
		ActorID:           dbvalue.Text(dbvalue.FormatUUID(hubUserDID)),
		SubjectHubUserDid: hubUserDID,
		SubjectOrgDid:     command.Authority.DID,
		Source:            "mesh-api",
		Payload:           auditPayload,
	}); err != nil {
		return commands.Result{}, fmt.Errorf("insert audit event: %w", err)
	}

	if err := agencycontacts.EnqueuePointer(ctx, q, agencycontacts.Pointer{
		ContactID:         contactID,
		OrgDID:            command.Authority.DID,
		HubUserDID:        hubUserDID,
		Version:           int32(newVersion),
		Present:           true,
		HasConversation:   true,
		AgencyDisplayName: conversation.RecordedAgencyName,
		AgencyDomain:      orgs.OrgDomain(conversation.RecordedAgencyDomain),
		LastActivityAt:    &now,
		NewAgencyMessage:  false,
	}); err != nil {
		return commands.Result{}, fmt.Errorf("enqueue pointer: %w", err)
	}

	msgResult := contacts.ConversationMessage{
		MessageID:         contacts.MessageID(dbvalue.FormatUUID(msgRow.MessageID)),
		SenderType:        contacts.MessageSenderType(msgRow.SenderType),
		SenderDisplayName: msgRow.SenderDisplayName,
		Kind:              contacts.MessageKind(msgRow.Kind),
		SentAt:            msgRow.SentAt.Time.UTC(),
	}
	if msgRow.MessageText.Valid {
		t := contacts.MessageText(msgRow.MessageText.String)
		msgResult.Text = &t
	}
	return commands.Succeeded(http.StatusOK, msgResult), nil
}

func handleDelete(ctx context.Context, tx pgx.Tx, command commands.Command) (commands.Result, error) {
	var payload federationspec.HubConversationDeletePayload
	if fields := decodePayload(command, &payload); len(fields) > 0 {
		details := problem.ValidationFailedError
		details.Fields = fields
		return commands.Rejected(details), nil
	}

	contactID, err := dbvalue.ParseUUID(string(payload.ContactID))
	if err != nil {
		return commands.Result{}, err
	}
	hubUserDID, err := dbvalue.ParseUUID(string(payload.HubUserDID))
	if err != nil {
		return commands.Result{}, err
	}

	q := sqlc.New(tx)
	_, err = q.GetOrgContact(ctx, sqlc.GetOrgContactParams{
		OrgDid:    command.Authority.DID,
		ContactID: contactID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return commands.Rejected(hubproblem.HubConversationNotFoundError), nil
	}
	if err != nil {
		return commands.Result{}, fmt.Errorf("get contact: %w", err)
	}

	conversation, err := q.GetOrgConversationByContact(ctx, contactID)
	if errors.Is(err, pgx.ErrNoRows) {
		return commands.Rejected(hubproblem.HubConversationNotFoundError), nil
	}
	if err != nil {
		return commands.Result{}, fmt.Errorf("get conversation: %w", err)
	}

	// Delete conversation (messages cascade)
	if _, err := q.DeleteOrgConversationByContact(ctx, contactID); err != nil {
		return commands.Result{}, fmt.Errorf("delete conversation: %w", err)
	}

	now := time.Now().UTC()
	contactRow, err := q.TouchOrgContactPointer(ctx, sqlc.TouchOrgContactPointerParams{
		ContactID:      contactID,
		LastActivityAt: pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		return commands.Result{}, fmt.Errorf("touch contact pointer: %w", err)
	}
	newVersion := contactRow.PointerVersion

	auditPayload, _ := json.Marshal(map[string]any{
		"action": "deleted",
	})
	if err := q.InsertAuditEvent(ctx, sqlc.InsertAuditEventParams{
		TenantID:          command.TenantID,
		Action:            "org.conversation.deleted",
		EntityType:        "org_conversation",
		EntityID:          dbvalue.FormatUUID(conversation.ConversationID),
		ActorType:         "hub_user",
		ActorID:           dbvalue.Text(dbvalue.FormatUUID(hubUserDID)),
		SubjectHubUserDid: hubUserDID,
		SubjectOrgDid:     command.Authority.DID,
		Source:            "mesh-api",
		Payload:           auditPayload,
	}); err != nil {
		return commands.Result{}, fmt.Errorf("insert audit event: %w", err)
	}

	if err := agencycontacts.EnqueuePointer(ctx, q, agencycontacts.Pointer{
		ContactID:         contactID,
		OrgDID:            command.Authority.DID,
		HubUserDID:        hubUserDID,
		Version:           int32(newVersion),
		Present:           true,
		HasConversation:   false,
		AgencyDisplayName: conversation.RecordedAgencyName,
		AgencyDomain:      orgs.OrgDomain(conversation.RecordedAgencyDomain),
	}); err != nil {
		return commands.Result{}, fmt.Errorf("enqueue pointer: %w", err)
	}

	return commands.Succeeded(http.StatusOK, struct{}{}), nil
}
