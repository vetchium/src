package agencycontacts

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

// ErrConversationReadOnly reports that accepting would append to a
// conversation whose other party is gone; nothing was written.
var ErrConversationReadOnly = errors.New("conversation is read-only")

// Answer is the recipient's answer to a pending request.
type Answer struct {
	Accept bool
	// Scope is set exactly when declining.
	Scope contacts.ChatRequestDeclineScope
	// Window is the Hub tenant's window from the Hub user's command; NULL
	// keeps the one the request carries (MKT-REQ-004).
	Window pgtype.Int8
	// HubUserName and HubUserHandle are the Hub user's names now, which a
	// conversation records.
	HubUserName, HubUserHandle string
}

// Answerer is who answers, for the audit events of every effect.
type Answerer struct {
	TenantID, ActorType, ActorID, Source string
	IdempotencyKey                       pgtype.Text
	// OrgUserID is the agency user who answered a request to the agency.
	OrgUserID pgtype.UUID
}

// AnswerRequest applies the recipient's answer to a pending request whose
// Contact the caller has locked (MKT-REQ-005, MKT-REQ-007, MKT-REQ-012).
// Accepting appends the request to the pair's conversation, creating it
// when there is none, at the request's sent time; its Opening becomes a
// suggestion when the agency sent it. The request's sender was active when
// it sent it and the recipient when it answered. Declining deletes the note
// and blocks the sender's direction. It returns the answered request; the
// caller syncs the pointer.
func AnswerRequest(
	ctx context.Context, q *sqlc.Queries, request sqlc.VetchiumOrgChatRequest,
	answer Answer, by Answerer,
) (sqlc.VetchiumOrgChatRequest, error) {
	var conversationID pgtype.UUID
	if answer.Accept {
		id, err := appendRequest(ctx, q, request, answer, by)
		if err != nil {
			return request, err
		}
		conversationID = id
	}
	params := sqlc.AnswerOrgChatRequestParams{
		State:  string(contacts.ChatRequestAccepted),
		OrgDid: request.OrgDid, RequestID: request.RequestID,
		AnsweredBy: by.OrgUserID, WindowSeconds: answer.Window,
		TenantID: by.TenantID, ActorType: by.ActorType, ActorID: by.ActorID,
		Source: by.Source, IdempotencyKey: by.IdempotencyKey,
	}
	if !answer.Accept {
		params.State = string(contacts.ChatRequestDeclined)
		params.DeclineScope = dbvalue.Text(string(answer.Scope))
	}
	answered, err := q.AnswerOrgChatRequest(ctx, params)
	if err != nil {
		return request, fmt.Errorf("answer chat request: %w", err)
	}
	if answered.AuditRows != 1 {
		return request, fmt.Errorf("incomplete chat request answer")
	}
	request.State, request.Note = answered.State, pgtype.Text{}
	request.DeclineScope, request.WindowSeconds = answered.DeclineScope, answered.WindowSeconds
	request.AnsweredAt, request.AnsweredBy = answered.AnsweredAt, by.OrgUserID

	if !answer.Accept {
		return request, block(ctx, q, request)
	}
	activity := sqlc.SetConversationActivityParams{
		ConversationID: conversationID, WindowSeconds: request.WindowSeconds,
		AgencyActivityAt: request.SentAt, HubActivityAt: answered.AnsweredAt,
	}
	if request.Direction == string(contacts.ToAgency) {
		activity.AgencyActivityAt, activity.HubActivityAt = answered.AnsweredAt, request.SentAt
	}
	if rows, err := q.SetConversationActivity(ctx, activity); err != nil || rows != 1 {
		return request, fmt.Errorf("start the window: %d rows, %w", rows, err)
	}
	return request, nil
}

// appendRequest appends the accepted request to the pair's conversation,
// creating it when there is none.
func appendRequest(
	ctx context.Context, q *sqlc.Queries, request sqlc.VetchiumOrgChatRequest,
	answer Answer, by Answerer,
) (pgtype.UUID, error) {
	existing, err := q.GetOrgConversation(ctx, sqlc.GetOrgConversationParams{
		OrgDid: request.OrgDid, ContactID: request.ContactID,
	})
	conversationID := existing.ConversationID
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		agency, err := q.GetAgencyDetails(ctx, request.OrgDid)
		if err != nil {
			return conversationID, fmt.Errorf("read agency: %w", err)
		}
		if conversationID, err = dbvalue.NewUUID(); err != nil {
			return conversationID, err
		}
		created, err := q.CreateOrgConversationFromRequest(ctx,
			sqlc.CreateOrgConversationFromRequestParams{
				ConversationID: conversationID, ContactID: request.ContactID,
				OrgDid: request.OrgDid, HubUserDid: request.HubUserDid,
				RecordedHubUserName:   answer.HubUserName,
				RecordedHubUserHandle: answer.HubUserHandle,
				RecordedAgencyName:    agency.DisplayName,
				RecordedAgencyDomain:  agency.Domain,
				TenantID:              by.TenantID, ActorType: by.ActorType,
				ActorID: by.ActorID, Source: by.Source,
				IdempotencyKey: by.IdempotencyKey, RequestID: request.RequestID,
			})
		if err != nil {
			return conversationID, fmt.Errorf("create conversation: %w", err)
		}
		if created.AuditRows != 1 {
			return conversationID, fmt.Errorf("incomplete conversation creation")
		}
	case err != nil:
		return conversationID, fmt.Errorf("read conversation: %w", err)
	case existing.ReadOnlyReason.Valid:
		return conversationID, ErrConversationReadOnly
	}

	messageID, err := dbvalue.NewUUID()
	if err != nil {
		return conversationID, err
	}
	sender := contacts.MessageSenderTypeAgency
	if request.Direction == string(contacts.ToAgency) {
		sender = contacts.MessageSenderTypeHubUser
	}
	message, err := q.AddOrgConversationMessage(ctx, sqlc.AddOrgConversationMessageParams{
		MessageID: messageID, ConversationID: conversationID,
		SenderType:        string(sender),
		SenderUserID:      request.SenderUserID,
		SenderDisplayName: request.SenderDisplayName,
		Kind:              string(contacts.MessageKindRequest),
		MessageText:       request.Note,
		ConsumerDomain:    dbvalue.Text(request.ConsumerDomain),
		OpeningNumber:     pgtype.Int4{Int32: request.OpeningNumber, Valid: true},
		SentAt:            request.SentAt,
		HubUserName:       dbvalue.Text(answer.HubUserName),
		HubUserHandle:     dbvalue.Text(answer.HubUserHandle),
		TenantID:          by.TenantID, ActorType: by.ActorType, ActorID: by.ActorID,
		Source: by.Source, IdempotencyKey: by.IdempotencyKey,
	})
	if err != nil {
		return conversationID, fmt.Errorf("add request message: %w", err)
	}
	if message.ConversationRows != 1 || message.ContactRows != 1 || message.AuditRows != 1 {
		return conversationID, fmt.Errorf("incomplete request message")
	}
	return conversationID, nil
}

// block records what a decline refuses the sender. A sender block ends when
// BlockedUntil says, so the pointer and the refusal agree.
func block(ctx context.Context, q *sqlc.Queries, request sqlc.VetchiumOrgChatRequest) error {
	params := sqlc.CreateOrgChatRequestBlockParams{
		ContactID:        request.ContactID,
		BlockedDirection: request.Direction,
		Scope:            request.DeclineScope.String,
	}
	if until := BlockedUntil(request); until != nil {
		params.BlockedUntil = dbvalue.Timestamp(*until)
	} else {
		params.ConsumerDomain = dbvalue.Text(request.ConsumerDomain)
		params.OpeningNumber = pgtype.Int4{Int32: request.OpeningNumber, Valid: true}
	}
	if _, err := q.CreateOrgChatRequestBlock(ctx, params); err != nil {
		return fmt.Errorf("block chat requests: %w", err)
	}
	return nil
}
