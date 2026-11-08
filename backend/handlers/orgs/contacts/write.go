package contacts

import (
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/agencycontacts"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

const replayWindow = 24 * time.Hour

func noteFrom(
	number int32, author, text string, created, edited pgtype.Timestamptz,
) contacts.ContactNote {
	note := contacts.ContactNote{
		NoteNumber: contacts.NoteNumber(number),
		Author:     common.EmailAddress(author), Mine: true,
		Text: contacts.NoteText(text), CreatedAt: created.Time.UTC(),
	}
	if edited.Valid {
		at := edited.Time.UTC()
		note.EditedAt = &at
	}
	return note
}

// AddPersonNote writes a note on the person at an address. The first note on
// a person creates the agency's Contact, within the daily limit and only
// while the agency has a listed `sourcing` Listing (MKT-DAT-013). The person
// is read before the transaction opens: no transaction waits on another
// tenant.
func AddPersonNote(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contacts.AddPersonNoteRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		read, ok := readProfile(s, w, r, identity, string(request.Address))
		if !ok {
			return
		}
		hubDID, err := dbvalue.ParseUUID(string(read.HubUserDID))
		if err != nil {
			s.InternalError(r.Context(), w, "parse Hub user DID", err)
			return
		}
		credited := creditedCounts(r.Context(), s, identity.OrgDID,
			[]pgtype.UUID{hubDID})[dbvalue.FormatUUID(hubDID)]
		now := s.CurrentTime()
		type result = handlerauth.Result[contacts.AddedNote]
		handlerauth.RunIdempotent(s, w, r, "orgs:add-person-note",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(replayWindow),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				ctx := r.Context()
				fail := func(details problem.Body) (result, *handlerauth.Problem, error) {
					return handlerauth.Failure[contacts.AddedNote](details)
				}
				if _, err := q.LockOrgForContacts(ctx, identity.OrgDID); err != nil {
					return result{}, nil, fmt.Errorf("lock Org: %w", err)
				}
				name, handle := string(read.Profile.DisplayName), string(read.Profile.Handle)
				contact, err := q.GetOrgContactByPerson(ctx, sqlc.GetOrgContactByPersonParams{
					OrgDid: identity.OrgDID, HubUserDid: hubDID,
				})
				switch {
				case isNoRows(err):
					listed, err := q.OrgHasListedSourcingListing(ctx, identity.OrgDID)
					if err != nil {
						return result{}, nil, err
					}
					if !listed {
						return fail(orgsproblem.ListingNotAvailableError)
					}
					today := pgtype.Date{Time: now.UTC().Truncate(24 * time.Hour), Valid: true}
					created, err := q.CountOrgContactsCreatedOn(ctx, sqlc.CountOrgContactsCreatedOnParams{
						OrgDid: identity.OrgDID, Day: today,
					})
					if err != nil {
						return result{}, nil, err
					}
					if created >= contacts.MaxNewContactsPerDay {
						return fail(orgsproblem.ContactLimitReachedError)
					}
					row, err := q.CreateOrgContact(ctx, sqlc.CreateOrgContactParams{
						OrgDid: identity.OrgDID, HubUserDid: hubDID,
						DisplayName: name, Handle: handle,
						RequestsOff: !read.AgenciesMayMessage, ActorID: identity.UserID,
						Day: today, TenantID: s.TenantID,
						IdempotencyKey: dbvalue.Text(string(key)),
					})
					if err != nil {
						return result{}, nil, err
					}
					if row.CreatedRows != 1 || row.CountedRows != 1 || row.AuditRows != 1 {
						return result{}, nil, fmt.Errorf("incomplete Contact creation")
					}
					if err := agencycontacts.SyncPointer(ctx, q, identity.OrgDID, hubDID, agencycontacts.NoNotice); err != nil {
						return result{}, nil, err
					}
				case err != nil:
					return result{}, nil, err
				default:
					if contact.DisplayName != name {
						changed, err := q.RefreshOrgContactNames(ctx, sqlc.RefreshOrgContactNamesParams{
							DisplayName: name, HubUserDid: hubDID,
							OrgDid: identity.OrgDID, TenantID: s.TenantID,
							ActorID:        identity.UserID,
							IdempotencyKey: dbvalue.Text(string(key)),
						})
						if err != nil {
							return result{}, nil, err
						}
						if changed.ChangedRows != 1 || changed.AuditRows != 1 {
							return result{}, nil, fmt.Errorf("incomplete Contact refresh")
						}
					}
					if _, err := q.LockOrgContact(ctx, sqlc.LockOrgContactParams{
						OrgDid: identity.OrgDID, HubUserDid: hubDID,
					}); err != nil {
						return result{}, nil, fmt.Errorf("lock Contact: %w", err)
					}
				}
				added, problemDetails, err := insertNote(
					r, s, q, identity, key, hubDID,
					string(request.Text), credited, now)
				if err != nil || problemDetails != nil {
					if problemDetails != nil {
						return fail(*problemDetails)
					}
					return result{}, nil, err
				}
				return result{Status: http.StatusOK, Body: added}, nil, nil
			})
	}
}

// insertNote adds a note to a Contact the caller holds the lock of and reads
// the Contact back with its note count. credited was counted before the
// transaction opened: no transaction waits on another tenant.
func insertNote(
	r *http.Request, s *orgsruntime.Server, q *sqlc.Queries,
	identity middleware.OrgIdentity, key common.IdempotencyKey,
	hubDID pgtype.UUID, text string, credited int32, now time.Time,
) (contacts.AddedNote, *problem.Body, error) {
	ctx := r.Context()
	row, err := q.AddOrgContactNote(ctx, sqlc.AddOrgContactNoteParams{
		NoteLimit: contacts.MaxNotesPerContact, HubUserDid: hubDID,
		ActorID: identity.UserID, NoteText: text,
		TenantID: s.TenantID, OrgDid: identity.OrgDID,
		IdempotencyKey: dbvalue.Text(string(key)),
	})
	if err != nil {
		return contacts.AddedNote{}, nil, err
	}
	if !row.HasRoom {
		details := problem.Body(orgsproblem.ContactNoteLimitReachedError)
		return contacts.AddedNote{}, &details, nil
	}
	if !row.NoteNumber.Valid || row.AuditRows != 1 {
		return contacts.AddedNote{}, nil, fmt.Errorf("incomplete note insertion")
	}
	contact, err := q.GetOrgContactByPerson(ctx, sqlc.GetOrgContactByPersonParams{
		OrgDid: identity.OrgDID, HubUserDid: hubDID,
	})
	if err != nil {
		return contacts.AddedNote{}, nil, err
	}
	return contacts.AddedNote{
		Contact: summary(sqlc.ListOrgContactsRow(contact), credited, now),
		Note: noteFrom(row.NoteNumber.Int32, row.Author, text, row.CreatedAt,
			pgtype.Timestamptz{}),
	}, nil, nil
}

func AddContactNote(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contacts.AddContactNoteRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		var credited int32
		if found, err := s.Queries.GetOrgContactByHandle(r.Context(), sqlc.GetOrgContactByHandleParams{
			OrgDid: identity.OrgDID, Handle: string(request.Handle),
		}); err == nil {
			credited = creditedCounts(r.Context(), s, identity.OrgDID,
				[]pgtype.UUID{found.HubUserDid})[dbvalue.FormatUUID(found.HubUserDid)]
		} else if !isNoRows(err) {
			s.InternalError(r.Context(), w, "read Contact", err)
			return
		}
		now := s.CurrentTime()
		type result = handlerauth.Result[contacts.AddedNote]
		handlerauth.RunIdempotent(s, w, r, "orgs:add-contact-note",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(replayWindow),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				locked, err := q.LockOrgContactByHandle(r.Context(), sqlc.LockOrgContactByHandleParams{
					OrgDid: identity.OrgDID, Handle: string(request.Handle),
				})
				if isNoRows(err) {
					return handlerauth.Failure[contacts.AddedNote](orgsproblem.ContactNotFoundError)
				}
				if err != nil {
					return result{}, nil, err
				}
				// A deleted account keeps only its conversation (MKT-CON-004).
				deleted, err := q.OrgContactAccountDeleted(r.Context(),
					sqlc.OrgContactAccountDeletedParams{
						OrgDid: identity.OrgDID, HubUserDid: locked.HubUserDid,
					})
				if err != nil {
					return result{}, nil, err
				}
				if deleted {
					return handlerauth.Failure[contacts.AddedNote](orgsproblem.ConversationPartyDeletedError)
				}
				added, details, err := insertNote(r, s, q, identity, key,
					locked.HubUserDid, string(request.Text), credited, now)
				if details != nil {
					return handlerauth.Failure[contacts.AddedNote](*details)
				}
				if err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusOK, Body: added}, nil, nil
			})
	}
}

// EditContactNote replaces the text of a note; only its author may
// (MKT-NOTE-002).
func EditContactNote(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contacts.EditContactNoteRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[contacts.ContactNote]
		handlerauth.RunIdempotent(s, w, r, "orgs:edit-contact-note",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(replayWindow),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				ctx := r.Context()
				locked, err := q.LockOrgContactByHandle(ctx, sqlc.LockOrgContactByHandleParams{
					OrgDid: identity.OrgDID, Handle: string(request.Handle),
				})
				if isNoRows(err) {
					return handlerauth.Failure[contacts.ContactNote](orgsproblem.ContactNotFoundError)
				} else if err != nil {
					return result{}, nil, err
				}
				author, err := q.GetOrgContactNoteAuthor(ctx, sqlc.GetOrgContactNoteAuthorParams{
					OrgDid: identity.OrgDID, HubUserDid: locked.HubUserDid,
					NoteNumber: int32(request.NoteNumber),
				})
				if isNoRows(err) {
					return handlerauth.Failure[contacts.ContactNote](orgsproblem.ContactNoteNotFoundError)
				}
				if err != nil {
					return result{}, nil, err
				}
				if author != identity.UserID {
					return handlerauth.Failure[contacts.ContactNote](orgsproblem.ContactNoteNotAuthorError)
				}
				row, err := q.EditOrgContactNote(ctx, sqlc.EditOrgContactNoteParams{
					NoteText: string(request.Text), NoteNumber: int32(request.NoteNumber),
					HubUserDid: locked.HubUserDid, ActorID: identity.UserID,
					TenantID: s.TenantID, OrgDid: identity.OrgDID,
					IdempotencyKey: dbvalue.Text(string(key)),
				})
				if err != nil {
					return result{}, nil, err
				}
				if row.AuditRows != 1 {
					return result{}, nil, fmt.Errorf("incomplete note edit")
				}
				return result{Status: http.StatusOK, Body: noteFrom(
					row.NoteNumber, row.Author, string(request.Text), row.CreatedAt, row.EditedAt,
				)}, nil, nil
			})
	}
}
