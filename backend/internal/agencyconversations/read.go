package agencyconversations

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/vetchium/src/typespec/common"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/orgs/openings"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

// ErrInvalidCursor reports a pagination key this read never issued.
var ErrInvalidCursor = errors.New("invalid conversation cursor")

// cursor is where the next, older page resumes. It is not signed: it only
// positions a read already confined to the caller's own conversation.
type cursor struct {
	At time.Time `json:"at"`
	ID string    `json:"id"`
}

// ReadForHubUser reads one page of the conversation as the Hub user sees it,
// newest first: agency messages name the agency, never the agency user, and
// the agency's unread state stays behind (MKT-CNV-005). pgx.ErrNoRows reports
// a conversation that is not the Hub user's.
func ReadForHubUser(
	ctx context.Context, q sqlc.Querier,
	request federationspec.MeshReadConversationRequest,
) (federationspec.MeshReadConversationResponse, error) {
	var response federationspec.MeshReadConversationResponse
	orgDID, err := dbvalue.ParseUUID(string(request.AgencyOrgDID))
	if err != nil {
		return response, pgx.ErrNoRows
	}
	contactID, err := dbvalue.ParseUUID(string(request.ContactID))
	if err != nil {
		return response, pgx.ErrNoRows
	}
	hubDID, err := dbvalue.ParseUUID(string(request.HubUserDID))
	if err != nil {
		return response, pgx.ErrNoRows
	}
	conversation, err := q.GetOrgConversation(ctx, sqlc.GetOrgConversationParams{
		OrgDid: orgDID, ContactID: contactID,
	})
	if err != nil {
		return response, err
	}
	if conversation.HubUserDid != hubDID {
		return response, pgx.ErrNoRows
	}
	limit := request.EffectiveLimit()
	params := sqlc.ListOrgConversationMessagesParams{
		ConversationID: conversation.ConversationID, PageLimit: limit + 1,
	}
	if request.PaginationKey != nil {
		before, err := parseCursor(*request.PaginationKey)
		if err != nil {
			return response, err
		}
		params.BeforeSentAt = dbvalue.Timestamp(before.At)
		params.BeforeMessageID, _ = dbvalue.ParseUUID(before.ID)
	}
	rows, err := q.ListOrgConversationMessages(ctx, params)
	if err != nil {
		return response, err
	}
	if conversation.ReadOnlyReason.Valid {
		reason := contacts.ConversationReadOnlyReason(conversation.ReadOnlyReason.String)
		response.ReadOnlyReason = &reason
	}
	response.Messages = make([]contacts.ConversationMessage, 0, len(rows))
	for index, row := range rows {
		if index == int(limit) {
			last := rows[index-1]
			key, err := formatCursor(cursor{
				At: last.SentAt.Time.UTC(), ID: dbvalue.FormatUUID(last.MessageID),
			})
			if err != nil {
				return response, err
			}
			response.NextPaginationKey = &key
			break
		}
		name := row.SenderDisplayName
		if row.SenderType == string(contacts.MessageSenderTypeAgency) {
			name = conversation.RecordedAgencyName
		}
		response.Messages = append(response.Messages, hubMessage(row, name))
	}
	return response, nil
}

func hubMessage(
	row sqlc.ListOrgConversationMessagesRow, name string,
) contacts.ConversationMessage {
	message := contacts.ConversationMessage{
		MessageID:         contacts.MessageID(dbvalue.FormatUUID(row.MessageID)),
		SenderType:        contacts.MessageSenderType(row.SenderType),
		SenderDisplayName: name,
		Kind:              contacts.MessageKind(row.Kind),
		SentAt:            row.SentAt.Time.UTC(),
	}
	if row.MessageText.Valid {
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

func formatCursor(value cursor) (common.PaginationKey, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return common.PaginationKey(base64.RawURLEncoding.EncodeToString(encoded)), nil
}

func parseCursor(key common.PaginationKey) (cursor, error) {
	var value cursor
	decoded, err := base64.RawURLEncoding.DecodeString(string(key))
	if err != nil || json.Unmarshal(decoded, &value) != nil || value.At.IsZero() {
		return cursor{}, ErrInvalidCursor
	}
	if _, err := dbvalue.ParseUUID(value.ID); err != nil {
		return cursor{}, ErrInvalidCursor
	}
	return value, nil
}
