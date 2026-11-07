package messages

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	federationspec "github.com/vetchium/src/typespec/federation"
	hubmessages "github.com/vetchium/src/typespec/hub/messages"
	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
	"backend/internal/publicopenings"
)

// openingAgencies reads the agencies assigned to a published Opening where
// the Org is homed, answering as the Opening page does when it cannot.
func openingAgencies(
	s *hubruntime.Server, w http.ResponseWriter, r *http.Request,
	request openingsspec.MeshListOpeningAgenciesRequest,
) ([]openingsspec.MeshOpeningAgency, bool) {
	result, err := s.PublicOpenings.Agencies(r.Context(), request)
	switch {
	case errors.Is(err, publicopenings.ErrOrgNotFound):
		outcome, relayErr := s.Openings.RelayAgencies(r.Context(), request)
		if relayErr != nil {
			s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
			return nil, false
		}
		if outcome.Problem != nil {
			s.Problem(r.Context(), w, openingProblem(outcome.Problem.Type))
			return nil, false
		}
		return outcome.Result.Items, true
	case errors.Is(err, publicopenings.ErrOpeningNotFound):
		s.Problem(r.Context(), w, hubproblem.OpeningNotFoundError)
		return nil, false
	case err != nil:
		s.InternalError(r.Context(), w, "list local Opening agencies", err)
		return nil, false
	}
	return result.Items, true
}

func openingProblem(problemType string) problem.Details {
	switch problemType {
	case hubproblem.OrgNotFoundError.Type:
		return hubproblem.OrgNotFoundError
	case hubproblem.OpeningNotFoundError.Type:
		return hubproblem.OpeningNotFoundError
	default:
		return hubproblem.OrgUnavailableError
	}
}

// agencyChat is the Hub user's chat with one agency, as their pointer to it
// shows; a nil pointer is no chat at all.
type agencyChat struct {
	pointer *sqlc.ListHubAgencyPointersForAgenciesRow
	request *federationspec.AgencyPointerRequest
}

func newAgencyChat(pointer *sqlc.ListHubAgencyPointersForAgenciesRow) (agencyChat, error) {
	chat := agencyChat{pointer: pointer}
	if pointer == nil || pointer.Request == nil {
		return chat, nil
	}
	var request federationspec.AgencyPointerRequest
	if err := json.Unmarshal(pointer.Request, &request); err != nil {
		return chat, fmt.Errorf("decode pointer request: %w", err)
	}
	chat.request = &request
	return chat, nil
}

// state answers what the Hub user may do about the Opening with the agency
// (MKT-HUB-005). The pointer keeps only the latest request, so an older
// `opening` decline surfaces only when the agency refuses the request.
func (c agencyChat) state(
	opening contacts.OpeningSuggestion, now time.Time,
) hubmessages.OpeningAgencyChatState {
	if c.pointer == nil {
		return hubmessages.OpeningAgencyNone
	}
	if c.request != nil && c.request.State == contacts.ChatRequestPending {
		if c.request.Direction == contacts.ToAgency {
			return hubmessages.OpeningAgencyRequestSent
		}
		return hubmessages.OpeningAgencyRequestReceived
	}
	if c.pointer.HasConversation && !c.pointer.ReadOnlyReason.Valid &&
		c.pointer.HubMayWriteUntil.Valid && c.pointer.HubMayWriteUntil.Time.After(now) {
		return hubmessages.OpeningAgencyOpen
	}
	if c.declined(opening, now) {
		return hubmessages.OpeningAgencyDeclined
	}
	if c.pointer.HasConversation {
		return hubmessages.OpeningAgencyClosed
	}
	return hubmessages.OpeningAgencyNone
}

// declined reports whether the agency's decline of the Hub user's latest
// request refuses a request about the Opening now (MKT-REQ-007).
func (c agencyChat) declined(opening contacts.OpeningSuggestion, now time.Time) bool {
	request := c.request
	if request == nil || request.Direction != contacts.ToAgency ||
		request.State != contacts.ChatRequestDeclined || request.DeclineScope == nil {
		return false
	}
	switch *request.DeclineScope {
	case contacts.DeclineOpening:
		return request.ConsumerDomain == opening.ConsumerDomain &&
			request.OpeningNumber == opening.OpeningNumber
	case contacts.DeclineSender:
		return request.BlockedUntil != nil && request.BlockedUntil.After(now)
	}
	return false
}

// pointersByAgency reads the Hub user's pointers to the listed agencies.
func pointersByAgency(
	s *hubruntime.Server, r *http.Request, hubDID pgtype.UUID,
	agencies []openingsspec.MeshOpeningAgency,
) (map[string]sqlc.ListHubAgencyPointersForAgenciesRow, error) {
	dids := make([]pgtype.UUID, 0, len(agencies))
	for _, agency := range agencies {
		did, err := dbvalue.ParseUUID(string(agency.AgencyOrgDID))
		if err != nil {
			return nil, fmt.Errorf("parse agency DID: %w", err)
		}
		dids = append(dids, did)
	}
	rows, err := s.Queries.ListHubAgencyPointersForAgencies(r.Context(),
		sqlc.ListHubAgencyPointersForAgenciesParams{
			HubUserDid: hubDID, AgencyOrgDids: dids,
		})
	if err != nil {
		return nil, fmt.Errorf("read agency pointers: %w", err)
	}
	byAgency := make(map[string]sqlc.ListHubAgencyPointersForAgenciesRow, len(rows))
	for _, row := range rows {
		byAgency[dbvalue.FormatUUID(row.AgencyOrgDid)] = row
	}
	return byAgency, nil
}

// ListOpeningAgencies lists the agencies assigned to a published Opening
// with the Hub user's chat with each (MKT-HUB-005). The agency's Org DID
// never leaves the Hub tenant.
func ListOpeningAgencies(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubmessages.ListOpeningAgenciesRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		agencies, ok := openingAgencies(s, w, r, openingsspec.MeshListOpeningAgenciesRequest{
			Domain: request.Domain, OpeningNumber: openingsspec.OpeningNumber(request.OpeningNumber),
		})
		if !ok {
			return
		}
		pointers, err := pointersByAgency(s, r, identity.UserDID, agencies)
		if err != nil {
			s.InternalError(r.Context(), w, "read agency pointers", err)
			return
		}
		opening := contacts.OpeningSuggestion{
			ConsumerDomain: request.Domain, OpeningNumber: request.OpeningNumber,
		}
		now := s.CurrentTime()
		items := make([]hubmessages.OpeningAgency, 0, len(agencies))
		for _, agency := range agencies {
			item := hubmessages.OpeningAgency{
				AgencyDisplayName: agency.AgencyDisplayName,
				AgencyDomain:      agency.AgencyDomain,
			}
			var chat agencyChat
			if pointer, found := pointers[string(agency.AgencyOrgDID)]; found {
				if chat, err = newAgencyChat(&pointer); err != nil {
					s.InternalError(r.Context(), w, "read agency pointer", err)
					return
				}
				if pointer.HasConversation || chat.request != nil {
					contactID := contacts.ContactID(dbvalue.FormatUUID(pointer.ContactID))
					item.ContactID = &contactID
				}
				if chat.request != nil {
					latest := hubChatRequest(s, pointer.ContactID,
						agency.AgencyDisplayName, string(agency.AgencyDomain), *chat.request)
					item.LatestRequest = &latest
				}
			}
			item.ChatState = chat.state(opening, now)
			items = append(items, item)
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, hubmessages.ListOpeningAgenciesResponse{Items: items})
	}
}
