package agencycontacts

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/orgs/openings"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

// WriteWindow is until when each side of a conversation may write
// (MKT-REQ-004): the agency until the Hub user's activity plus the window,
// the Hub user until the agency's. A nil instant means that side may not
// write at all.
type WriteWindow struct {
	AgencyUntil *time.Time
	HubUntil    *time.Time
}

// Window reads a conversation's activity columns.
func Window(hubActivity, agencyActivity pgtype.Timestamptz, seconds pgtype.Int8) WriteWindow {
	if !seconds.Valid || seconds.Int64 <= 0 {
		return WriteWindow{}
	}
	window := time.Duration(seconds.Int64) * time.Second
	until := func(activity pgtype.Timestamptz) *time.Time {
		if !activity.Valid {
			return nil
		}
		at := activity.Time.Add(window).UTC()
		return &at
	}
	return WriteWindow{AgencyUntil: until(hubActivity), HubUntil: until(agencyActivity)}
}

// AgencyMayWrite reports whether the agency may write at now; the instant
// itself is already closed.
func (w WriteWindow) AgencyMayWrite(now time.Time) bool {
	return w.AgencyUntil != nil && w.AgencyUntil.After(now)
}

// HubMayWrite reports whether the Hub user may write at now.
func (w WriteWindow) HubMayWrite(now time.Time) bool {
	return w.HubUntil != nil && w.HubUntil.After(now)
}

// Open drops each instant that has passed at now, as the reads show them.
func (w WriteWindow) Open(now time.Time) WriteWindow {
	open := WriteWindow{}
	if w.AgencyMayWrite(now) {
		open.AgencyUntil = w.AgencyUntil
	}
	if w.HubMayWrite(now) {
		open.HubUntil = w.HubUntil
	}
	return open
}

// BlockedUntil is when a `sender` decline lifts: one window after the
// answer (MKT-REQ-007). It is nil for every other request.
func BlockedUntil(request sqlc.VetchiumOrgChatRequest) *time.Time {
	if request.DeclineScope.String != string(contacts.DeclineSender) ||
		!request.AnsweredAt.Valid || !request.WindowSeconds.Valid {
		return nil
	}
	at := request.AnsweredAt.Time.Add(
		time.Duration(request.WindowSeconds.Int64) * time.Second).UTC()
	return &at
}

// WindowDays is the window in whole days, as portals show it; nil until a
// Hub command carried the window.
func WindowDays(seconds pgtype.Int8) *int32 {
	if !seconds.Valid {
		return nil
	}
	days := int32(seconds.Int64 / int64(24*time.Hour/time.Second))
	return &days
}

// PointerRequest is a request as the Hub user's pointer keeps it, without
// its note (MKT-DAT-003).
func PointerRequest(request sqlc.VetchiumOrgChatRequest) federationspec.AgencyPointerRequest {
	pointer := federationspec.AgencyPointerRequest{
		RequestID:      contacts.ChatRequestID(dbvalue.FormatUUID(request.RequestID)),
		Direction:      contacts.ChatRequestDirection(request.Direction),
		State:          contacts.ChatRequestState(request.State),
		ConsumerDomain: orgs.OrgDomain(request.ConsumerDomain),
		OpeningNumber:  openings.OpeningNumber(request.OpeningNumber),
		SentAt:         request.SentAt.Time.UTC(),
		BlockedUntil:   BlockedUntil(request),
	}
	if request.AnsweredAt.Valid {
		at := request.AnsweredAt.Time.UTC()
		pointer.AnsweredAt = &at
	}
	if request.DeclineScope.Valid {
		scope := contacts.ChatRequestDeclineScope(request.DeclineScope.String)
		pointer.DeclineScope = &scope
	}
	return pointer
}
