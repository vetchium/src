package agencycontacts

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"

	"backend/internal/db/sqlc"
)

// Refusal is why a new chat request may not be sent (MKT-REQ-003). Each
// portal names it with its own problem type.
type Refusal int

const (
	NotRefused Refusal = iota
	// RefusedPartyDeleted: the person's account no longer exists.
	RefusedPartyDeleted
	// RefusedRequestPending: a request between the pair is pending, in
	// either direction.
	RefusedRequestPending
	// RefusedConversationOpen: the sender may still write in the
	// conversation.
	RefusedConversationOpen
	// RefusedBlocked: the recipient's decline blocks the sender's
	// direction, for this Opening or until a date.
	RefusedBlocked
)

// Refuse applies MKT-REQ-003 in its order to a new request in direction
// about the Opening. The caller holds the Contact lock.
func Refuse(
	ctx context.Context, q sqlc.Querier, orgDID, contactID pgtype.UUID,
	direction contacts.ChatRequestDirection, opening contacts.OpeningSuggestion,
	now time.Time,
) (Refusal, error) {
	deleted, err := q.OrgContactAccountDeleted(ctx, contactID)
	if err != nil {
		return NotRefused, err
	}
	if deleted {
		return RefusedPartyDeleted, nil
	}
	switch _, err := q.GetPendingOrgChatRequest(ctx, contactID); {
	case err == nil:
		return RefusedRequestPending, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return NotRefused, err
	}
	conversation, err := q.GetOrgConversation(ctx, sqlc.GetOrgConversationParams{
		OrgDid: orgDID, ContactID: contactID,
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return NotRefused, err
	default:
		window := Window(conversation.HubActivityAt,
			conversation.AgencyActivityAt, conversation.WindowSeconds)
		if direction == contacts.ToHubUser && window.AgencyMayWrite(now) ||
			direction == contacts.ToAgency && window.HubMayWrite(now) {
			return RefusedConversationOpen, nil
		}
	}
	switch _, err := q.FindBlockingChatRequestBlock(ctx,
		sqlc.FindBlockingChatRequestBlockParams{
			ContactID: contactID, BlockedDirection: string(direction),
			ConsumerDomain: string(opening.ConsumerDomain),
			OpeningNumber:  int32(opening.OpeningNumber),
		}); {
	case err == nil:
		return RefusedBlocked, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return NotRefused, err
	}
	return NotRefused, nil
}
