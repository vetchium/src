package agencyconversations

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/agencycontacts"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
)

// answerAudit is who answered, for every audited effect of the answer.
type answerAudit struct {
	tenantID, hubUserID string
	key                 pgtype.Text
}

// handleChatRequestAnswer applies a Hub user's answer to an agency's request
// (MKT-REQ-005, MKT-REQ-007). It returns the answered request as the
// pointer keeps it.
func handleChatRequestAnswer(ctx context.Context, tx pgx.Tx, command commands.Command) (commands.Result, error) {
	var payload federationspec.HubChatRequestAnswerPayload
	if rejected := decode(command, &payload, func() string {
		return string(payload.RequestID)
	}); rejected != nil {
		return *rejected, nil
	}
	requestID, err := dbvalue.ParseUUID(string(payload.RequestID))
	if err != nil {
		return commands.Result{}, err
	}
	contactID, err := dbvalue.ParseUUID(string(payload.ContactID))
	if err != nil {
		return commands.Result{}, err
	}
	hubDID, err := dbvalue.ParseUUID(string(payload.HubUserDID))
	if err != nil {
		return commands.Result{}, err
	}
	orgDID := command.Authority.DID
	q := sqlc.New(tx)

	contact, err := q.LockOrgContact(ctx, sqlc.LockOrgContactParams{
		OrgDid: orgDID, ContactID: contactID,
	})
	if errors.Is(err, pgx.ErrNoRows) || err == nil && contact.HubUserDid != hubDID {
		return commands.Rejected(hubproblem.HubChatRequestNotFoundError), nil
	}
	if err != nil {
		return commands.Result{}, fmt.Errorf("lock Contact: %w", err)
	}
	found, err := q.GetOrgChatRequest(ctx, sqlc.GetOrgChatRequestParams{
		OrgDid: orgDID, RequestID: requestID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return commands.Rejected(hubproblem.HubChatRequestNotFoundError), nil
	}
	if err != nil {
		return commands.Result{}, fmt.Errorf("read chat request: %w", err)
	}
	request := found.VetchiumOrgChatRequest
	if request.ContactID != contactID || request.HubUserDid != hubDID ||
		request.Direction != string(contacts.ToHubUser) ||
		request.State != string(contacts.ChatRequestPending) {
		return commands.Rejected(hubproblem.HubChatRequestNotFoundError), nil
	}

	audit := answerAudit{
		tenantID: command.TenantID, hubUserID: dbvalue.FormatUUID(hubDID),
		key: dbvalue.Text(dbvalue.FormatUUID(command.CommandID)),
	}
	window := pgtype.Int8{Int64: payload.WindowSeconds, Valid: true}
	var conversationID pgtype.UUID
	if payload.Accept {
		var partyDeleted bool
		conversationID, partyDeleted, err = acceptChatRequest(ctx, q, request, payload, audit)
		if err != nil {
			return commands.Result{}, err
		}
		if partyDeleted {
			return commands.Rejected(hubproblem.HubConversationPartyDeletedError), nil
		}
	}
	answer := sqlc.AnswerOrgChatRequestParams{
		State:  string(contacts.ChatRequestAccepted),
		OrgDid: orgDID, RequestID: requestID, WindowSeconds: window,
		TenantID: audit.tenantID, ActorType: "hub_user", ActorID: audit.hubUserID,
		Source: "federation-command", IdempotencyKey: audit.key,
	}
	if !payload.Accept {
		answer.State = string(contacts.ChatRequestDeclined)
		answer.DeclineScope = dbvalue.Text(string(*payload.Scope))
	}
	answered, err := q.AnswerOrgChatRequest(ctx, answer)
	if err != nil {
		return commands.Result{}, fmt.Errorf("answer chat request: %w", err)
	}
	if answered.AuditRows != 1 {
		return commands.Result{}, fmt.Errorf("incomplete chat request answer")
	}
	request.State, request.Note = answered.State, pgtype.Text{}
	request.DeclineScope, request.WindowSeconds = answered.DeclineScope, answered.WindowSeconds
	request.AnsweredAt = answered.AnsweredAt
	if payload.Accept {
		// Accepting is the Hub user's activity; the accepted request is the
		// agency's, at its sent time (MKT-REQ-004).
		if rows, err := q.SetConversationActivity(ctx, sqlc.SetConversationActivityParams{
			ConversationID:   conversationID,
			AgencyActivityAt: request.SentAt,
			HubActivityAt:    answered.AnsweredAt,
			WindowSeconds:    window,
		}); err != nil || rows != 1 {
			return commands.Result{}, fmt.Errorf("start the window: %d rows, %w", rows, err)
		}
	} else if err := blockChatRequests(ctx, q, request); err != nil {
		return commands.Result{}, err
	}

	name, handle := string(payload.HubUserDisplayName), string(payload.HubUserHandle)
	if _, err := q.RefreshOrgContactNamesFromHubUser(ctx,
		sqlc.RefreshOrgContactNamesFromHubUserParams{
			ContactID: contactID, OrgDid: orgDID,
			DisplayName: name, Handle: handle,
		}); err != nil {
		return commands.Result{}, fmt.Errorf("refresh Contact names: %w", err)
	}
	if err := agencycontacts.SyncPointer(ctx, q, orgDID, contactID, agencycontacts.NoNotice); err != nil {
		return commands.Result{}, err
	}
	return commands.Succeeded(http.StatusOK, agencycontacts.PointerRequest(request)), nil
}

// acceptChatRequest appends the request to the pair's conversation,
// creating it when there is none: the request becomes its message at the
// request's sent time and its Opening a suggestion. It writes nothing and
// reports true when the conversation is read-only.
func acceptChatRequest(
	ctx context.Context, q *sqlc.Queries, request sqlc.VetchiumOrgChatRequest,
	payload federationspec.HubChatRequestAnswerPayload, audit answerAudit,
) (pgtype.UUID, bool, error) {
	name, handle := string(payload.HubUserDisplayName), string(payload.HubUserHandle)
	existing, err := q.GetOrgConversation(ctx, sqlc.GetOrgConversationParams{
		OrgDid: request.OrgDid, ContactID: request.ContactID,
	})
	conversationID := existing.ConversationID
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		agency, err := q.GetAgencyDetails(ctx, request.OrgDid)
		if err != nil {
			return pgtype.UUID{}, false, fmt.Errorf("read agency: %w", err)
		}
		if conversationID, err = dbvalue.NewUUID(); err != nil {
			return pgtype.UUID{}, false, err
		}
		created, err := q.CreateOrgConversationFromRequest(ctx,
			sqlc.CreateOrgConversationFromRequestParams{
				ConversationID: conversationID, ContactID: request.ContactID,
				OrgDid: request.OrgDid, HubUserDid: request.HubUserDid,
				RecordedHubUserName: name, RecordedHubUserHandle: handle,
				RecordedAgencyName: agency.DisplayName, RecordedAgencyDomain: agency.Domain,
				TenantID: audit.tenantID, ActorType: "hub_user", ActorID: audit.hubUserID,
				Source: "federation-command", IdempotencyKey: audit.key,
				RequestID: request.RequestID,
			})
		if err != nil {
			return pgtype.UUID{}, false, fmt.Errorf("create conversation: %w", err)
		}
		if created.AuditRows != 1 {
			return pgtype.UUID{}, false, fmt.Errorf("incomplete conversation creation")
		}
	case err != nil:
		return pgtype.UUID{}, false, fmt.Errorf("read conversation: %w", err)
	case existing.ReadOnlyReason.Valid:
		return pgtype.UUID{}, true, nil
	}

	messageID, err := dbvalue.NewUUID()
	if err != nil {
		return pgtype.UUID{}, false, err
	}
	message, err := q.AddOrgConversationMessage(ctx, sqlc.AddOrgConversationMessageParams{
		MessageID: messageID, ConversationID: conversationID,
		SenderType:        string(contacts.MessageSenderTypeAgency),
		SenderUserID:      request.SenderUserID,
		SenderDisplayName: request.SenderDisplayName,
		Kind:              string(contacts.MessageKindRequest),
		MessageText:       request.Note,
		ConsumerDomain:    dbvalue.Text(request.ConsumerDomain),
		OpeningNumber:     pgtype.Int4{Int32: request.OpeningNumber, Valid: true},
		SentAt:            request.SentAt,
		HubUserName:       dbvalue.Text(name), HubUserHandle: dbvalue.Text(handle),
		TenantID: audit.tenantID, ActorType: "hub_user", ActorID: audit.hubUserID,
		Source: "federation-command", IdempotencyKey: audit.key,
	})
	if err != nil {
		return pgtype.UUID{}, false, fmt.Errorf("add request message: %w", err)
	}
	if message.ConversationRows != 1 || message.ContactRows != 1 || message.AuditRows != 1 {
		return pgtype.UUID{}, false, fmt.Errorf("incomplete request message")
	}
	return conversationID, false, nil
}

// blockChatRequests records what a decline refuses the agency
// (MKT-REQ-007). A sender block ends when BlockedUntil says, so the pointer
// and the refusal agree.
func blockChatRequests(ctx context.Context, q *sqlc.Queries, request sqlc.VetchiumOrgChatRequest) error {
	block := sqlc.CreateOrgChatRequestBlockParams{
		ContactID:        request.ContactID,
		BlockedDirection: request.Direction,
		Scope:            request.DeclineScope.String,
	}
	if until := agencycontacts.BlockedUntil(request); until != nil {
		block.BlockedUntil = dbvalue.Timestamp(*until)
	} else {
		block.ConsumerDomain = dbvalue.Text(request.ConsumerDomain)
		block.OpeningNumber = pgtype.Int4{Int32: request.OpeningNumber, Valid: true}
	}
	if _, err := q.CreateOrgChatRequestBlock(ctx, block); err != nil {
		return fmt.Errorf("block chat requests: %w", err)
	}
	return nil
}
