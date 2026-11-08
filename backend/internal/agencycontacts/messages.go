package agencycontacts

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/orgs/openings"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/events"
)

// DeletedMessage is the "Message deleted" stub both parties see in place of
// a deleted message (MKT-CNV-007).
func DeletedMessage(row sqlc.DeleteOrgConversationMessageRow) contacts.ConversationMessage {
	return contacts.ConversationMessage{
		MessageNumber:     contacts.MessageNumber(row.MessageNumber),
		SenderType:        contacts.MessageSenderType(row.SenderType),
		SenderDisplayName: row.SenderDisplayName,
		Kind:              contacts.MessageKind(row.Kind),
		SentAt:            row.SentAt.Time.UTC(),
		Deleted:           true,
	}
}

// EnqueueAgencyMessageDeleted tells the Hub user's tenant that the agency
// deleted one of its messages, so the Hub user's side records the deletion
// in its own audit. The event never carries the text (MKT-CNV-007). Call it
// in the transaction that deletes the message.
func EnqueueAgencyMessageDeleted(
	ctx context.Context, q sqlc.Querier, orgDID, hubDID pgtype.UUID,
	agencyDomain string, number int32,
) error {
	payload := federationspec.AgencyMessageDeletedPayload{
		AgencyOrgDID:  orgs.OrgDID(dbvalue.FormatUUID(orgDID)),
		HubUserDID:    hub.HubUserDID(dbvalue.FormatUUID(hubDID)),
		AgencyDomain:  orgs.OrgDomain(agencyDomain),
		MessageNumber: contacts.MessageNumber(number),
	}
	_, err := events.Enqueue(ctx, q, events.Outgoing{
		Kind: federationspec.AgencyMessageDeletedKind,
		Destination: events.Principal{
			Type: directoryspec.PrincipalHubUser, DID: hubDID,
		},
		AggregateType: federationspec.AgencyMessageAggregate,
		AggregateID: federationspec.AgencyMessageAggregateID(
			payload.AgencyOrgDID, payload.HubUserDID, payload.MessageNumber),
		AggregateVersion: 1,
		Payload:          payload,
	})
	if err != nil {
		return fmt.Errorf("enqueue agency message deletion: %w", err)
	}
	return nil
}

// applyAgencyMessageDeleted records, on the Hub user's side, that the agency
// deleted one of its messages.
func applyAgencyMessageDeleted(ctx context.Context, tx pgx.Tx, event events.Event) error {
	var payload federationspec.AgencyMessageDeletedPayload
	if err := decodePayload(event, &payload); err != nil {
		return err
	}
	hubDID, err := dbvalue.ParseUUID(string(payload.HubUserDID))
	if err != nil {
		return err
	}
	if event.Destination.Type != directoryspec.PrincipalHubUser ||
		event.Destination.DID != hubDID ||
		event.AggregateType != federationspec.AgencyMessageAggregate ||
		event.AggregateID != federationspec.AgencyMessageAggregateID(
			payload.AgencyOrgDID, payload.HubUserDID, payload.MessageNumber) {
		return fmt.Errorf("agency-message-deleted envelope does not match its payload")
	}
	rows, err := sqlc.New(tx).AuditHubAgencyMessageDeleted(ctx,
		sqlc.AuditHubAgencyMessageDeletedParams{
			TenantID: event.TenantID, AgencyDomain: string(payload.AgencyDomain),
			ActorType: "org", ActorID: string(payload.AgencyOrgDID),
			HubUserDid: hubDID, Source: "federation-event",
			IdempotencyKey: dbvalue.Text(dbvalue.FormatUUID(event.EventID)),
			MessageNumber:  int32(payload.MessageNumber),
			DeletedBy:      string(contacts.MessageSenderTypeAgency),
		})
	if err != nil {
		return fmt.Errorf("audit agency message deletion: %w", err)
	}
	if rows != 1 {
		return fmt.Errorf("incomplete agency message deletion audit")
	}
	return nil
}

// Message is a stored message under the sender name the reader sees. A
// deleted message is its stub: no text, note or suggestion (MKT-CNV-007).
func Message(row sqlc.ListOrgConversationMessagesRow, name string) contacts.ConversationMessage {
	message := contacts.ConversationMessage{
		MessageNumber:     contacts.MessageNumber(row.MessageNumber),
		SenderType:        contacts.MessageSenderType(row.SenderType),
		SenderDisplayName: name,
		Kind:              contacts.MessageKind(row.Kind),
		SentAt:            row.SentAt.Time.UTC(),
		Deleted:           row.DeletedAt.Valid,
	}
	if message.Deleted {
		return message
	}
	switch {
	case !row.MessageText.Valid:
	case row.Kind == string(contacts.MessageKindRequest):
		note := contacts.ChatRequestNote(row.MessageText.String)
		message.Note = &note
	default:
		text := contacts.MessageText(row.MessageText.String)
		message.Text = &text
	}
	if row.ConsumerDomain.Valid && row.OpeningNumber.Valid {
		message.Suggestion = &contacts.OpeningSuggestion{
			ConsumerDomain: orgs.OrgDomain(row.ConsumerDomain.String),
			OpeningNumber:  openings.OpeningNumber(row.OpeningNumber.Int32),
		}
	}
	return message
}
