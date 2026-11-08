package agencyconversations

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"

	"backend/internal/agencycontacts"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

// ErrInvalidCursor reports a pagination key this read never issued.
var ErrInvalidCursor = errors.New("invalid conversation cursor")

// cursor is where the next, older page resumes. It is not signed: it only
// positions a read already confined to the caller's own conversation.
type cursor struct {
	At     time.Time `json:"at"`
	Number int32     `json:"n"`
}

// ReadForHubUser reads one page of the conversation as the Hub user sees it,
// newest first: agency messages name the agency, never the agency user, and
// the agency's unread state stays behind (MKT-CNV-005). It carries the open
// write-until instants and a pending request's note, which only this live
// read reveals (MKT-DAT-005); a pair with only a pending request reads as
// no messages. A request naming a message number reads only that message.
// pgx.ErrNoRows reports a pair with neither, or no such message.
func ReadForHubUser(
	ctx context.Context, q sqlc.Querier,
	request federationspec.MeshReadConversationRequest,
) (federationspec.MeshReadConversationResponse, error) {
	var response federationspec.MeshReadConversationResponse
	orgDID, err := dbvalue.ParseUUID(string(request.AgencyOrgDID))
	if err != nil {
		return response, pgx.ErrNoRows
	}
	hubDID, err := dbvalue.ParseUUID(string(request.HubUserDID))
	if err != nil {
		return response, pgx.ErrNoRows
	}
	found, err := q.GetPendingOrgChatRequest(ctx, sqlc.GetPendingOrgChatRequestParams{
		OrgDid: orgDID, HubUserDid: hubDID,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return response, err
	}
	pending := found.VetchiumOrgChatRequest
	hasPending := err == nil
	if hasPending && pending.Note.Valid {
		note := contacts.ChatRequestNote(pending.Note.String)
		response.PendingRequestNote = &note
	}
	conversation, err := q.GetOrgConversation(ctx, sqlc.GetOrgConversationParams{
		OrgDid: orgDID, HubUserDid: hubDID,
	})
	if errors.Is(err, pgx.ErrNoRows) && hasPending && request.MessageNumber == nil {
		response.Messages = []contacts.ConversationMessage{}
		return response, nil
	}
	if err != nil {
		return response, err
	}
	window := agencycontacts.Window(conversation.HubActivityAt,
		conversation.AgencyActivityAt, conversation.WindowSeconds).Open(time.Now())
	response.AgencyMayWriteUntil, response.HubMayWriteUntil = window.AgencyUntil, window.HubUntil
	if conversation.ReadOnlyReason.Valid {
		reason := contacts.ConversationReadOnlyReason(conversation.ReadOnlyReason.String)
		response.ReadOnlyReason = &reason
	}
	if request.MessageNumber != nil {
		row, err := q.GetOrgConversationMessage(ctx, sqlc.GetOrgConversationMessageParams{
			OrgDid: orgDID, HubUserDid: hubDID, MessageNumber: int32(*request.MessageNumber),
		})
		if err != nil {
			return response, err
		}
		response.Messages = []contacts.ConversationMessage{
			hubMessage(sqlc.ListOrgConversationMessagesRow(row), conversation.RecordedAgencyName),
		}
		return response, nil
	}
	limit := request.EffectiveLimit()
	params := sqlc.ListOrgConversationMessagesParams{
		OrgDid: orgDID, HubUserDid: hubDID, PageLimit: limit + 1,
	}
	if request.PaginationKey != nil {
		before, err := parseCursor(*request.PaginationKey)
		if err != nil {
			return response, err
		}
		params.BeforeSentAt = dbvalue.Timestamp(before.At)
		params.BeforeMessageNumber = pgtype.Int4{Int32: before.Number, Valid: true}
	}
	rows, err := q.ListOrgConversationMessages(ctx, params)
	if err != nil {
		return response, err
	}
	response.Messages = make([]contacts.ConversationMessage, 0, len(rows))
	for index, row := range rows {
		if index == int(limit) {
			last := rows[index-1]
			key, err := formatCursor(cursor{
				At: last.SentAt.Time.UTC(), Number: last.MessageNumber,
			})
			if err != nil {
				return response, err
			}
			response.NextPaginationKey = &key
			break
		}
		response.Messages = append(response.Messages, hubMessage(row, conversation.RecordedAgencyName))
	}
	return response, nil
}

// hubMessage is a message as the Hub user reads it: the agency's messages
// carry the agency's name.
func hubMessage(
	row sqlc.ListOrgConversationMessagesRow, agencyName string,
) contacts.ConversationMessage {
	name := row.SenderDisplayName
	if row.SenderType == string(contacts.MessageSenderTypeAgency) {
		name = agencyName
	}
	return agencycontacts.Message(row, name)
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
	if err != nil || json.Unmarshal(decoded, &value) != nil || value.At.IsZero() ||
		value.Number < 1 {
		return cursor{}, ErrInvalidCursor
	}
	return value, nil
}
