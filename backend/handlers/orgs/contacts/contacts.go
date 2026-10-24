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
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/orgs/marketplace/work"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/credentials"
	"backend/internal/dbvalue"
	orgsruntime "backend/internal/orgs"
)

const (
	contactsPurpose = "orgs-list-contacts-v1"
	notesPurpose    = "orgs-list-contact-notes-v1"
)

// summary converts the columns every Contact read selects.
func summary(
	id pgtype.UUID, name, handle string, off, accountDeleted bool,
	active pgtype.Timestamptz, notes int32, credited int32, hasConversation bool,
	unreadCount int32,
) contacts.ContactSummary {
	return contacts.ContactSummary{
		ContactID:           contacts.ContactID(dbvalue.FormatUUID(id)),
		DisplayName:         common.DisplayName(name),
		Handle:              hubHandle(handle),
		MessagesOff:         off,
		AccountDeleted:      accountDeleted,
		NoteCount:           notes,
		HasConversation:     hasConversation,
		UnreadMessagesCount: unreadCount,
		CreditedCount:       credited,
		LastActivityAt:      active.Time.UTC(),
	}
}

func orgDID(identityOrg pgtype.UUID) orgs.OrgDID {
	return orgs.OrgDID(dbvalue.FormatUUID(identityOrg))
}

func creditedCountForHubUser(ctx context.Context, s *orgsruntime.Server, orgDID pgtype.UUID, hubUserDID pgtype.UUID) int32 {
	if len(s.WorkFanout.Tenants) == 0 {
		return 0
	}
	peer := work.PeerListCreditedApplicationsRequest{
		ProviderOrgDID: orgs.OrgDID(dbvalue.FormatUUID(orgDID)),
		Limit:          work.MaxPage,
	}
	page := s.WorkFanout.ListCreditedApplications(ctx, peer)
	hubDIDStr := dbvalue.FormatUUID(hubUserDID)
	var count int32
	for _, item := range page.Items {
		if item.ApplicantDID != nil && string(*item.ApplicantDID) == hubDIDStr {
			count++
		}
	}
	return count
}

func creditedCountsForAgency(ctx context.Context, s *orgsruntime.Server, orgDID pgtype.UUID) map[string]int32 {
	counts := make(map[string]int32)
	if len(s.WorkFanout.Tenants) == 0 {
		return counts
	}
	peer := work.PeerListCreditedApplicationsRequest{
		ProviderOrgDID: orgs.OrgDID(dbvalue.FormatUUID(orgDID)),
		Limit:          work.MaxPage,
	}
	page := s.WorkFanout.ListCreditedApplications(ctx, peer)
	for _, item := range page.Items {
		if item.ApplicantDID != nil {
			counts[string(*item.ApplicantDID)]++
		}
	}
	return counts
}

// pageCursor is where the next page of a list resumes. It is bound to the Org,
// and for notes to the Contact, so a key cannot resume another list.
type pageCursor struct {
	Org     string    `json:"org"`
	Contact string    `json:"contact,omitempty"`
	At      time.Time `json:"at"`
	ID      string    `json:"id"`
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
		cursor.Org != org || cursor.Contact != contact {
		return pageCursor{}, false
	}
	if _, err := dbvalue.ParseUUID(cursor.ID); err != nil {
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
