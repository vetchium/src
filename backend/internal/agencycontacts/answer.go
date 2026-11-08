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

// ErrRequestNotFound reports that the agency has no pending request from a
// Hub user with that number: unknown, the agency's own, or already answered.
var ErrRequestNotFound = errors.New("no pending chat request to the agency")

// AnswerAgencyRequest applies an agency user's answer to a Hub user's
// pending request (MKT-REQ-002, MKT-CNV-004) and syncs the pointer, telling
// the Hub user when the agency accepts (MKT-REQ-010). The request keeps the
// window its Hub command carried, and the Contact's recorded names stand in
// for the Hub user's. It returns the answered request.
func AnswerAgencyRequest(
	ctx context.Context, q *sqlc.Queries, orgDID pgtype.UUID, handle string,
	requestNumber int32, answer Answer, by Answerer,
) (sqlc.VetchiumOrgChatRequest, error) {
	contact, err := q.LockOrgContactByHandle(ctx, sqlc.LockOrgContactByHandleParams{
		OrgDid: orgDID, Handle: handle,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.VetchiumOrgChatRequest{}, ErrRequestNotFound
	}
	if err != nil {
		return sqlc.VetchiumOrgChatRequest{}, fmt.Errorf("lock Contact: %w", err)
	}
	found, err := q.GetOrgChatRequest(ctx, sqlc.GetOrgChatRequestParams{
		OrgDid: orgDID, HubUserDid: contact.HubUserDid, RequestNumber: requestNumber,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.VetchiumOrgChatRequest{}, ErrRequestNotFound
	}
	if err != nil {
		return sqlc.VetchiumOrgChatRequest{}, fmt.Errorf("read chat request: %w", err)
	}
	request := found.VetchiumOrgChatRequest
	if request.Direction != string(contacts.ToAgency) ||
		request.State != string(contacts.ChatRequestPending) {
		return request, ErrRequestNotFound
	}
	answer.Window = pgtype.Int8{}
	answer.HubUserName, answer.HubUserHandle = contact.DisplayName, contact.Handle
	answered, err := AnswerRequest(ctx, q, request, answer, by)
	if err != nil {
		return answered, err
	}
	notice := NoNotice
	if answer.Accept {
		notice = NoticeRequestAccepted
	}
	return answered, SyncPointer(ctx, q, orgDID, request.HubUserDid, notice)
}

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
	if answer.Accept {
		if err := appendRequest(ctx, q, request, answer, by); err != nil {
			return request, err
		}
	}
	params := sqlc.AnswerOrgChatRequestParams{
		State:  string(contacts.ChatRequestAccepted),
		OrgDid: request.OrgDid, HubUserDid: request.HubUserDid,
		RequestNumber: request.RequestNumber,
		AnsweredBy:    by.OrgUserID, WindowSeconds: answer.Window,
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
		OrgDid: request.OrgDid, HubUserDid: request.HubUserDid,
		WindowSeconds:    request.WindowSeconds,
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
) error {
	existing, err := q.GetOrgConversation(ctx, sqlc.GetOrgConversationParams{
		OrgDid: request.OrgDid, HubUserDid: request.HubUserDid,
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		agency, err := q.GetAgencyDetails(ctx, request.OrgDid)
		if err != nil {
			return fmt.Errorf("read agency: %w", err)
		}
		created, err := q.CreateOrgConversationFromRequest(ctx,
			sqlc.CreateOrgConversationFromRequestParams{
				OrgDid: request.OrgDid, HubUserDid: request.HubUserDid,
				RecordedHubUserName:   answer.HubUserName,
				RecordedHubUserHandle: answer.HubUserHandle,
				RecordedAgencyName:    agency.DisplayName,
				RecordedAgencyDomain:  agency.Domain,
				TenantID:              by.TenantID, ActorType: by.ActorType,
				ActorID: by.ActorID, Source: by.Source,
				IdempotencyKey: by.IdempotencyKey, RequestNumber: request.RequestNumber,
			})
		if err != nil {
			return fmt.Errorf("create conversation: %w", err)
		}
		if created.CreatedRows != 1 || created.AuditRows != 1 {
			return fmt.Errorf("incomplete conversation creation")
		}
	case err != nil:
		return fmt.Errorf("read conversation: %w", err)
	case existing.ReadOnlyReason.Valid:
		return ErrConversationReadOnly
	}

	sender := contacts.MessageSenderTypeAgency
	if request.Direction == string(contacts.ToAgency) {
		sender = contacts.MessageSenderTypeHubUser
	}
	message, err := q.AddOrgConversationMessage(ctx, sqlc.AddOrgConversationMessageParams{
		OrgDid: request.OrgDid, HubUserDid: request.HubUserDid,
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
		return fmt.Errorf("add request message: %w", err)
	}
	if message.ContactRows != 1 || message.AuditRows != 1 {
		return fmt.Errorf("incomplete request message")
	}
	return nil
}

// block records what a decline refuses the sender. A sender block ends when
// BlockedUntil says, so the pointer and the refusal agree.
func block(ctx context.Context, q *sqlc.Queries, request sqlc.VetchiumOrgChatRequest) error {
	if until := BlockedUntil(request); until != nil {
		if _, err := q.SetOrgChatRequestSenderBlock(ctx, sqlc.SetOrgChatRequestSenderBlockParams{
			OrgDid: request.OrgDid, HubUserDid: request.HubUserDid,
			BlockedDirection: request.Direction, BlockedUntil: dbvalue.Timestamp(*until),
		}); err != nil {
			return fmt.Errorf("block chat requests: %w", err)
		}
		return nil
	}
	if _, err := q.CreateOrgChatRequestOpeningBlock(ctx, sqlc.CreateOrgChatRequestOpeningBlockParams{
		OrgDid: request.OrgDid, HubUserDid: request.HubUserDid,
		BlockedDirection: request.Direction, ConsumerDomain: request.ConsumerDomain,
		OpeningNumber: request.OpeningNumber,
	}); err != nil {
		return fmt.Errorf("block chat requests: %w", err)
	}
	return nil
}
