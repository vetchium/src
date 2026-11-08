package contacts

import (
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
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
			params.AfterHandle = dbvalue.Text(cursor.Handle)
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
		people := make([]pgtype.UUID, len(rows))
		for index, row := range rows {
			people[index] = row.HubUserDid
		}
		counts := creditedCounts(r.Context(), s, identity.OrgDID, people)
		response := contacts.ListContactsResponse{
			Items: []contacts.ContactSummary{},
			Counts: contacts.ContactCounts{
				All: tabs.AllContacts, RequestsReceived: tabs.RequestsReceived,
				Unread: tabs.Unread, RequestsSent: tabs.RequestsSent,
				HasConversation: tabs.HasConversation,
			},
		}
		now := time.Now()
		for index, row := range rows {
			if index == int(request.EffectiveLimit()) {
				key, err := sign(s, contactsPurpose, pageCursor{
					Org: org, At: response.Items[index-1].LastActivityAt,
					Handle: string(response.Items[index-1].Handle),
				})
				if err != nil {
					s.InternalError(r.Context(), w, "encode Contact cursor", err)
					return
				}
				response.NextPaginationKey = &key
				break
			}
			credited := counts[dbvalue.FormatUUID(row.HubUserDid)]
			response.Items = append(response.Items, summary(row, credited, now))
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

// contactByHandle reads the agency's Contact the portal names by handle, or
// writes the not-found problem.
func contactByHandle(
	s *orgsruntime.Server, w http.ResponseWriter, r *http.Request,
	identity middleware.OrgIdentity, handle hub.HubHandle,
) (sqlc.ListOrgContactsRow, bool) {
	row, err := s.Queries.GetOrgContactByHandle(r.Context(), sqlc.GetOrgContactByHandleParams{
		OrgDid: identity.OrgDID, Handle: string(handle),
	})
	if isNoRows(err) {
		s.Problem(r.Context(), w, orgsproblem.ContactNotFoundError)
		return sqlc.ListOrgContactsRow{}, false
	}
	if err != nil {
		s.InternalError(r.Context(), w, "read Contact", err)
		return sqlc.ListOrgContactsRow{}, false
	}
	return sqlc.ListOrgContactsRow(row), true
}

func GetContact(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contacts.ContactReference
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		row, ok := contactByHandle(s, w, r, identity, request.Handle)
		if !ok {
			return
		}
		pair := sqlc.ListContactOpeningSuggestionsParams{
			OrgDid: identity.OrgDID, HubUserDid: row.HubUserDid,
		}
		sugRows, err := s.Queries.ListContactOpeningSuggestions(r.Context(), pair)
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
		credited := creditedCounts(r.Context(), s, identity.OrgDID,
			[]pgtype.UUID{row.HubUserDid})[dbvalue.FormatUUID(row.HubUserDid)]
		var latest *contacts.ChatRequest
		switch request, err := s.Queries.GetLatestOrgChatRequest(r.Context(),
			sqlc.GetLatestOrgChatRequestParams(pair)); {
		case isNoRows(err):
		case err != nil:
			s.InternalError(r.Context(), w, "read latest chat request", err)
			return
		default:
			found := chatRequest(request.VetchiumOrgChatRequest,
				request.HubUserName, request.HubUserHandle)
			latest = &found
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, contacts.Contact{
			ContactSummary:    summary(row, credited, time.Now()),
			SuggestedOpenings: suggestedOpenings,
			LatestRequest:     latest,
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
		params := sqlc.ListOrgContactNotesParams{
			OrgDid: identity.OrgDID, PageLimit: request.EffectiveLimit() + 1,
		}
		if request.PaginationKey != nil {
			cursor, valid := verify(s, notesPurpose, *request.PaginationKey,
				org, string(request.Handle))
			if !valid {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			params.AfterCreatedAt = dbvalue.Timestamp(cursor.At)
			params.AfterNoteNumber = pgtype.Int4{Int32: cursor.Number, Valid: true}
		}
		contact, ok := contactByHandle(s, w, r, identity, request.Handle)
		if !ok {
			return
		}
		params.HubUserDid = contact.HubUserDid
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
					Org: org, Contact: string(request.Handle),
					At: last.CreatedAt, Number: int32(last.NoteNumber),
				})
				if err != nil {
					s.InternalError(r.Context(), w, "encode note cursor", err)
					return
				}
				response.NextPaginationKey = &key
				break
			}
			note := contacts.ContactNote{
				NoteNumber: contacts.NoteNumber(row.NoteNumber),
				Author:     common.EmailAddress(row.Author),
				Mine:       row.AuthorID == identity.UserID,
				Text:       contacts.NoteText(row.NoteText), CreatedAt: row.CreatedAt.Time.UTC(),
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
