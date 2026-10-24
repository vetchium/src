package contacts

import (
	"net/http"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/orgs/openings"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

// ListContacts lists the agency's Contacts, most recent activity first. The
// recorded names keep the list free of cross-tenant reads (MKT-CON-001).
func ListContacts(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contacts.ListContactsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		org := dbvalue.FormatUUID(identity.OrgDID)
		filter := "all"
		if request.Filter != nil {
			filter = string(*request.Filter)
		}
		params := sqlc.ListOrgContactsParams{
			OrgDid: identity.OrgDID, PageLimit: request.EffectiveLimit() + 1,
			Filter: filter,
		}
		if request.NameQuery != nil {
			params.NameQuery = dbvalue.Text(string(*request.NameQuery))
		}
		if request.PaginationKey != nil {
			cursor, valid := verify(s, contactsPurpose, *request.PaginationKey, org, "")
			if !valid {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			params.AfterActivityAt = dbvalue.Timestamp(cursor.At)
			params.AfterContactID, _ = dbvalue.ParseUUID(cursor.ID)
		}
		rows, err := s.Queries.ListOrgContacts(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "list Contacts", err)
			return
		}
		tabs, err := s.Queries.CountOrgContactsByTab(r.Context(), identity.OrgDID)
		if err != nil {
			s.InternalError(r.Context(), w, "count Contacts", err)
			return
		}
		counts := creditedCountsForAgency(r.Context(), s, identity.OrgDID)
		response := contacts.ListContactsResponse{
			Items: []contacts.ContactSummary{},
			Counts: contacts.ContactCounts{
				All: tabs.AllContacts, Unread: tabs.Unread,
				HasConversation: tabs.HasConversation, NotContacted: tabs.NotContacted,
			},
		}
		for index, row := range rows {
			if index == int(request.EffectiveLimit()) {
				key, err := sign(s, contactsPurpose, pageCursor{
					Org: org, At: response.Items[index-1].LastActivityAt,
					ID: string(response.Items[index-1].ContactID),
				})
				if err != nil {
					s.InternalError(r.Context(), w, "encode Contact cursor", err)
					return
				}
				response.NextPaginationKey = &key
				break
			}
			credited := counts[dbvalue.FormatUUID(row.HubUserDid)]
			if row.CreditedCount > credited {
				credited = row.CreditedCount
			}
			response.Items = append(response.Items, summary(row.ContactID,
				row.DisplayName, row.Handle, row.MessagesOff, row.PartyDeleted,
				row.LastActivityAt, row.NoteCount, credited, row.HasConversation,
				row.UnreadMessagesCount))
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func GetContact(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contacts.ContactReference
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		id, err := dbvalue.ParseUUID(string(request.ContactID))
		if err != nil {
			s.InternalError(r.Context(), w, "parse Contact id", err)
			return
		}
		row, err := s.Queries.GetOrgContact(r.Context(), sqlc.GetOrgContactParams{
			OrgDid: identity.OrgDID, ContactID: id,
		})
		if isNoRows(err) {
			s.Problem(r.Context(), w, orgsproblem.ContactNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "read Contact", err)
			return
		}
		sugRows, err := s.Queries.ListContactOpeningSuggestions(r.Context(),
			sqlc.ListContactOpeningSuggestionsParams{OrgDid: identity.OrgDID, ContactID: id})
		if err != nil {
			s.InternalError(r.Context(), w, "list contact opening suggestions", err)
			return
		}
		suggestedOpenings := make([]contacts.ContactOpeningSuggestion, 0, len(sugRows))
		for _, sug := range sugRows {
			suggestedOpenings = append(suggestedOpenings, contacts.ContactOpeningSuggestion{
				ConsumerDomain: orgs.OrgDomain(sug.ConsumerDomain),
				OpeningNumber:  openings.OpeningNumber(sug.OpeningNumber),
				SuggestedAt:    sug.SentAt.Time.UTC(),
			})
		}
		credited := creditedCountForHubUser(r.Context(), s, identity.OrgDID, row.HubUserDid)
		if row.CreditedCount > credited {
			credited = row.CreditedCount
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, contacts.Contact{
			ContactSummary: summary(row.ContactID, row.DisplayName, row.Handle,
				row.MessagesOff, row.PartyDeleted, row.LastActivityAt,
				row.NoteCount, credited, row.HasConversation,
				row.UnreadMessagesCount),
			CreatedBy:         common.EmailAddress(row.CreatedBy),
			SuggestedOpenings: suggestedOpenings,
			CreatedAt:         row.CreatedAt.Time.UTC(),
		})
	}
}

// ListContactNotes lists a Contact's notes, newest first. Every agency user
// with the permission reads every note of the agency (MKT-NOTE-002).
func ListContactNotes(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contacts.ListContactNotesRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		org := dbvalue.FormatUUID(identity.OrgDID)
		id, err := dbvalue.ParseUUID(string(request.ContactID))
		if err != nil {
			s.InternalError(r.Context(), w, "parse Contact id", err)
			return
		}
		params := sqlc.ListOrgContactNotesParams{
			ContactID: id, PageLimit: request.EffectiveLimit() + 1,
		}
		if request.PaginationKey != nil {
			cursor, valid := verify(s, notesPurpose, *request.PaginationKey,
				org, string(request.ContactID))
			if !valid {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			params.AfterCreatedAt = dbvalue.Timestamp(cursor.At)
			params.AfterNoteID, _ = dbvalue.ParseUUID(cursor.ID)
		}
		if _, err := s.Queries.GetOrgContact(r.Context(), sqlc.GetOrgContactParams{
			OrgDid: identity.OrgDID, ContactID: id,
		}); isNoRows(err) {
			s.Problem(r.Context(), w, orgsproblem.ContactNotFoundError)
			return
		} else if err != nil {
			s.InternalError(r.Context(), w, "read Contact", err)
			return
		}
		rows, err := s.Queries.ListOrgContactNotes(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "list Contact notes", err)
			return
		}
		response := contacts.ListContactNotesResponse{Items: []contacts.ContactNote{}}
		for index, row := range rows {
			if index == int(request.EffectiveLimit()) {
				last := response.Items[index-1]
				key, err := sign(s, notesPurpose, pageCursor{
					Org: org, Contact: string(request.ContactID),
					At: last.CreatedAt, ID: string(last.NoteID),
				})
				if err != nil {
					s.InternalError(r.Context(), w, "encode note cursor", err)
					return
				}
				response.NextPaginationKey = &key
				break
			}
			note := contacts.ContactNote{
				NoteID: contacts.ContactNoteID(dbvalue.FormatUUID(row.NoteID)),
				Author: common.EmailAddress(row.Author),
				Mine:   row.AuthorID == identity.UserID,
				Text:   contacts.NoteText(row.NoteText), CreatedAt: row.CreatedAt.Time.UTC(),
			}
			if row.EditedAt.Valid {
				edited := row.EditedAt.Time.UTC()
				note.EditedAt = &edited
			}
			response.Items = append(response.Items, note)
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}
