// Package contacts serves an agency's private record of the people it knows:
// the profile view, Contacts, and notes (agent-guides/marketplace.md,
// MKT-CON, MKT-NOTE, MKT-PRF). The agency's tenant is authoritative; the Hub
// user's tenant is read live and holds only a pointer.
package contacts

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/orgs/marketplace/work"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/agencycontacts"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	orgsruntime "backend/internal/orgs"
)

const (
	contactsPurpose = "orgs-list-contacts-v1"
	notesPurpose    = "orgs-list-contact-notes-v1"
)

// summary converts the columns every Contact read selects; GetOrgContactBy*
// rows convert to sqlc.ListOrgContactsRow.
func summary(row sqlc.ListOrgContactsRow, credited int32, now time.Time) contacts.ContactSummary {
	return contacts.ContactSummary{
		DisplayName:         common.DisplayName(row.DisplayName),
		Handle:              hubHandle(row.Handle),
		Status:              status(row, now),
		RequestsOff:         row.RequestsOff,
		AccountDeleted:      row.PartyDeleted,
		NoteCount:           row.NoteCount,
		HasConversation:     row.HasConversation,
		UnreadMessagesCount: row.UnreadMessagesCount,
		CreditedCount:       credited,
		LastActivityAt:      row.LastActivityAt.Time.UTC(),
	}
}

// status is the first Contact status that holds (MKT-UI-007). The agency's
// declined or expired request shows only while nothing newer happened in the
// conversation.
func status(row sqlc.ListOrgContactsRow, now time.Time) contacts.ContactStatus {
	switch contacts.ChatRequestDirection(row.PendingRequestDirection.String) {
	case contacts.ToAgency:
		return contacts.ContactRequestReceived
	case contacts.ToHubUser:
		return contacts.ContactRequestSent
	}
	window := agencycontacts.Window(row.ConversationHubActivityAt,
		pgtype.Timestamptz{}, row.ConversationWindowSeconds)
	if row.HasConversation && !row.PartyDeleted && window.AgencyMayWrite(now) {
		return contacts.ContactInConversation
	}
	newer := !row.HasConversation ||
		row.LatestSentRequestAnsweredAt.Time.After(row.ConversationLastActivityAt.Time)
	switch contacts.ChatRequestState(row.LatestSentRequestState) {
	case contacts.ChatRequestDeclined:
		if newer {
			return contacts.ContactRequestDeclined
		}
	case contacts.ChatRequestExpired:
		if newer {
			return contacts.ContactRequestExpired
		}
	}
	if row.HasConversation {
		return contacts.ContactConversationClosed
	}
	return contacts.ContactNoConversation
}

func orgDID(identityOrg pgtype.UUID) orgs.OrgDID {
	return orgs.OrgDID(dbvalue.FormatUUID(identityOrg))
}

// creditedCounts asks every client tenant how many applications credited to
// the agency each person has (MKT-UI-007), keyed by Hub user DID. A tenant
// that does not answer adds nothing.
func creditedCounts(
	ctx context.Context, s *orgsruntime.Server, orgDID pgtype.UUID,
	people []pgtype.UUID,
) map[string]int32 {
	if len(people) == 0 {
		return map[string]int32{}
	}
	dids := make([]hub.HubUserDID, len(people))
	for index, person := range people {
		dids[index] = hub.HubUserDID(dbvalue.FormatUUID(person))
	}
	return s.WorkFanout.CountCreditedApplications(ctx,
		work.PeerCountCreditedApplicationsRequest{
			ProviderOrgDID: orgs.OrgDID(dbvalue.FormatUUID(orgDID)),
			ApplicantDIDs:  dids,
		}).Counts
}

// pageCursor is where the next page of a list resumes. It is bound to the Org,
// and for notes and messages to the Contact, so a key cannot resume another
// list. Handle positions a Contact list; Number a note or message list.
type pageCursor struct {
	Org     string    `json:"org"`
	Contact string    `json:"contact,omitempty"`
	At      time.Time `json:"at"`
	Handle  string    `json:"handle,omitempty"`
	Number  int32     `json:"number,omitempty"`
}

func sign(s *orgsruntime.Server, purpose string, cursor pageCursor) (common.PaginationKey, error) {
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return common.PaginationKey(credentials.SignValue(
		s.CredentialSubkey("pagination"), purpose, payload)), nil
}

// verify reads a pagination key back, or reports that it does not belong to
// this list.
func verify(
	s *orgsruntime.Server, purpose string, key common.PaginationKey,
	org, contact string,
) (pageCursor, bool) {
	payload, valid := credentials.VerifySignedValue(
		s.CredentialSubkey("pagination"), purpose, string(key))
	var cursor pageCursor
	if !valid || json.Unmarshal(payload, &cursor) != nil ||
		cursor.Org != org || cursor.Contact != contact || cursor.At.IsZero() {
		return pageCursor{}, false
	}
	if (contact == "") != (cursor.Handle != "") || (contact == "") == (cursor.Number > 0) {
		return pageCursor{}, false
	}
	return cursor, true
}

func unavailable(s *orgsruntime.Server, w http.ResponseWriter, r *http.Request, err error) {
	attrs := []any{"event", "agency_profile_unavailable"}
	if err != nil {
		attrs = append(attrs, "error", err)
	}
	s.WarnContext(r.Context(), "Hub profile read did not answer", attrs...)
	s.Problem(r.Context(), w, orgsproblem.TenantUnavailableError)
}
