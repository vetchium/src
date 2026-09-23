package profile

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/vetchium/src/typespec/common"
	profilespec "github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
)

const professionalEmailCursorPurpose = "hub:profile:professional-email:list"

type professionalEmailCursor struct {
	ViewerDID      string     `json:"viewer_did"`
	LastVerifiedAt *time.Time `json:"last_verified_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	ID             string     `json:"id"`
}

func ListProfessionalEmails(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request profilespec.ListProfessionalEmailsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		viewerDID := dbvalue.FormatUUID(identity.UserDID)
		var cursor *professionalEmailCursor
		if request.PaginationKey != nil {
			decoded, ok := decodeProfessionalEmailCursor(
				s, string(*request.PaginationKey), viewerDID,
			)
			if !ok {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			cursor = &decoded
		}
		rows, err := s.Queries.ListHubProfessionalEmails(
			r.Context(), identity.UserDID,
		)
		if err != nil {
			s.InternalError(r.Context(), w, "list professional emails", err)
			return
		}
		response := profilespec.ListProfessionalEmailsResponse{
			Emails: []profilespec.ProfessionalEmail{},
		}
		limit := int(request.EffectiveLimit())
		var last *sqlc.ListHubProfessionalEmailsRow
		for i := range rows {
			row := &rows[i]
			if cursor != nil && !professionalEmailAfterCursor(*row, *cursor) {
				continue
			}
			if len(response.Emails) == limit {
				if last != nil {
					key, err := encodeProfessionalEmailCursor(
						s, viewerDID, *last,
					)
					if err != nil {
						s.InternalError(r.Context(), w, "encode email page key", err)
						return
					}
					response.NextPaginationKey = &key
				}
				break
			}
			response.Emails = append(response.Emails, professionalEmail(
				row.ProfessionalEmailID, row.EmailAddress, row.Domain,
				row.FirstVerifiedAt, row.LastVerifiedAt, row.CreatedAt,
			))
			last = row
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func encodeProfessionalEmailCursor(
	s *hubruntime.Server, viewerDID string,
	row sqlc.ListHubProfessionalEmailsRow,
) (common.PaginationKey, error) {
	payload, err := json.Marshal(professionalEmailCursor{
		ViewerDID:      viewerDID,
		LastVerifiedAt: dbvalue.TimePtr(row.LastVerifiedAt),
		CreatedAt:      row.CreatedAt.Time.UTC(),
		ID:             dbvalue.FormatUUID(row.ProfessionalEmailID),
	})
	if err != nil {
		return "", err
	}
	return common.PaginationKey(credentials.SignValue(
		s.CredentialSubkey("pagination"),
		professionalEmailCursorPurpose, payload,
	)), nil
}

func decodeProfessionalEmailCursor(
	s *hubruntime.Server, key, viewerDID string,
) (professionalEmailCursor, bool) {
	payload, ok := credentials.VerifySignedValue(
		s.CredentialSubkey("pagination"),
		professionalEmailCursorPurpose, key,
	)
	if !ok {
		return professionalEmailCursor{}, false
	}
	var cursor professionalEmailCursor
	if json.Unmarshal(payload, &cursor) != nil ||
		cursor.ViewerDID != viewerDID ||
		cursor.CreatedAt.IsZero() ||
		strings.TrimSpace(cursor.ID) != cursor.ID {
		return professionalEmailCursor{}, false
	}
	if _, err := dbvalue.ParseUUID(cursor.ID); err != nil {
		return professionalEmailCursor{}, false
	}
	return cursor, true
}

// The table permits at most ten rows per user, so this keyset comparison
// operates on one bounded SQL result while remaining stable if a prior row is
// removed between pages.
func professionalEmailAfterCursor(
	row sqlc.ListHubProfessionalEmailsRow,
	cursor professionalEmailCursor,
) bool {
	if cursor.LastVerifiedAt == nil {
		if row.LastVerifiedAt.Valid {
			return false
		}
	} else {
		if !row.LastVerifiedAt.Valid {
			return true
		}
		if row.LastVerifiedAt.Time.Before(*cursor.LastVerifiedAt) {
			return true
		}
		if row.LastVerifiedAt.Time.After(*cursor.LastVerifiedAt) {
			return false
		}
	}
	if row.CreatedAt.Time.Before(cursor.CreatedAt) {
		return true
	}
	if row.CreatedAt.Time.After(cursor.CreatedAt) {
		return false
	}
	return dbvalue.FormatUUID(row.ProfessionalEmailID) > cursor.ID
}
