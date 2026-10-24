package agencyconversations

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/orgs/openings"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

func ReadForHubUser(
	ctx context.Context, q sqlc.Querier, contactID, hubUserDID pgtype.UUID,
) (*contacts.ConversationSummary, []contacts.ConversationMessage, error) {
	conv, err := q.GetOrgConversationByContact(ctx, contactID)
	if err != nil {
		return nil, nil, err
	}
	if conv.HubUserDid != hubUserDID {
		return nil, nil, pgx.ErrNoRows
	}

	msgs, err := q.ListOrgConversationMessages(ctx, conv.ConversationID)
	if err != nil {
		return nil, nil, err
	}

	summary := summaryFromRow(conv)
	if summary.ReadOnlyReason == nil {
		if contact, err := q.GetOrgContact(ctx, sqlc.GetOrgContactParams{
			OrgDid:    conv.OrgDid,
			ContactID: contactID,
		}); err == nil && contact.MessagesOff {
			r := contacts.ConversationReadOnlyMessagesOff
			summary.ReadOnlyReason = &r
		}
	}
	resultMsgs := make([]contacts.ConversationMessage, 0, len(msgs))
	for _, m := range msgs {
		resultMsgs = append(resultMsgs, messageFromRow(m))
	}
	return &summary, resultMsgs, nil
}

func summaryFromRow(row sqlc.VetchiumOrgConversation) contacts.ConversationSummary {
	s := contacts.ConversationSummary{
		ConversationID:        contacts.ConversationID(dbvalue.FormatUUID(row.ConversationID)),
		ContactID:             contacts.ContactID(dbvalue.FormatUUID(row.ContactID)),
		RecordedHubUserName:   row.RecordedHubUserName,
		RecordedHubUserHandle: hub.HubHandle(row.RecordedHubUserHandle),
		RecordedAgencyName:    row.RecordedAgencyName,
		RecordedAgencyDomain:  orgs.OrgDomain(row.RecordedAgencyDomain),
		AgencyUnread:          row.AgencyUnread,
		CreatedAt:             row.CreatedAt.Time.UTC(),
		LastActivityAt:        row.LastActivityAt.Time.UTC(),
	}
	if row.ReadOnlyReason.Valid {
		r := contacts.ConversationReadOnlyReason(row.ReadOnlyReason.String)
		s.ReadOnlyReason = &r
	}
	return s
}

func messageFromRow(row sqlc.VetchiumOrgConversationMessage) contacts.ConversationMessage {
	msg := contacts.ConversationMessage{
		MessageID:         contacts.MessageID(dbvalue.FormatUUID(row.MessageID)),
		SenderType:        contacts.MessageSenderType(row.SenderType),
		SenderDisplayName: row.SenderDisplayName,
		Kind:              contacts.MessageKind(row.Kind),
		SentAt:            row.SentAt.Time.UTC(),
	}
	if row.MessageText.Valid {
		t := contacts.MessageText(row.MessageText.String)
		msg.Text = &t
	}
	if row.ConsumerDomain.Valid && row.OpeningNumber.Valid {
		msg.Suggestion = &contacts.OpeningSuggestion{
			ConsumerDomain: orgs.OrgDomain(row.ConsumerDomain.String),
			OpeningNumber:  openings.OpeningNumber(row.OpeningNumber.Int32),
		}
	}
	return msg
}
