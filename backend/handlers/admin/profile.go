package admin

import (
	"encoding/json"
	"net/http"

	admincommon "github.com/vetchium/src/typespec/admin/common"
	"github.com/vetchium/src/typespec/admin/users"
	"github.com/vetchium/src/typespec/common"

	"backend/internal/adminapi"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/middleware"
)

func SetPreferredLanguage(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var wire struct {
			PreferredLanguage json.RawMessage `json:"preferred_language"`
		}
		if err := apiserver.DecodeJSON(r, &wire); err != nil ||
			wire.PreferredLanguage == nil {
			if err == nil {
				err = errMissingField("preferred_language")
			}
			s.InvalidJSON(r.Context(), w, err)
			return
		}
		var value *admincommon.LanguageCode
		if string(wire.PreferredLanguage) != "null" {
			var language admincommon.LanguageCode
			if err := json.Unmarshal(wire.PreferredLanguage, &language); err != nil {
				s.InvalidJSON(r.Context(), w, err)
				return
			}
			value = &language
		}
		request := users.SetPreferredLanguageRequest{
			PreferredLanguage: value,
		}
		if fields := request.Validate(); len(fields) != 0 {
			s.ValidationFailed(r.Context(), w, fields)
			return
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		var textValue *string
		if value != nil {
			text := string(*value)
			textValue = &text
		}
		_, err := s.Queries.SetAdminPreferredLanguage(
			r.Context(), sqlc.SetAdminPreferredLanguageParams{
				AdminUserID:       identity.UserID,
				PreferredLanguage: adminapi.Text(textValue),
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "set preferred language", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func SetPreferredTimezone(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var wire struct {
			PreferredTimezone json.RawMessage `json:"preferred_timezone"`
		}
		if err := apiserver.DecodeJSON(r, &wire); err != nil ||
			wire.PreferredTimezone == nil {
			if err == nil {
				err = errMissingField("preferred_timezone")
			}
			s.InvalidJSON(r.Context(), w, err)
			return
		}
		var value *common.TimeZoneID
		if string(wire.PreferredTimezone) != "null" {
			var timezone common.TimeZoneID
			if err := json.Unmarshal(wire.PreferredTimezone, &timezone); err != nil {
				s.InvalidJSON(r.Context(), w, err)
				return
			}
			value = &timezone
		}
		request := users.SetPreferredTimezoneRequest{
			PreferredTimezone: value,
		}
		if fields := request.Validate(); len(fields) != 0 {
			s.ValidationFailed(r.Context(), w, fields)
			return
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		var textValue *string
		if value != nil {
			text := string(*value)
			textValue = &text
		}
		_, err := s.Queries.SetAdminPreferredTimezone(
			r.Context(), sqlc.SetAdminPreferredTimezoneParams{
				AdminUserID:       identity.UserID,
				PreferredTimezone: adminapi.Text(textValue),
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "set preferred timezone", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func SetDisplayNames(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.SetDisplayNamesRequest
		if err := apiserver.DecodeJSON(r, &request); err != nil {
			s.InvalidJSON(r.Context(), w, err)
			return
		}
		request = request.Normalize()
		if fields := request.Validate(); len(fields) != 0 {
			s.ValidationFailed(r.Context(), w, fields)
			return
		}
		languageCodes := make([]string, len(request.DisplayNames))
		displayNames := make([]string, len(request.DisplayNames))
		for index, displayName := range request.DisplayNames {
			languageCodes[index] = string(displayName.LanguageCode)
			displayNames[index] = string(displayName.DisplayName)
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		_, err := s.Queries.SetAdminDisplayNames(
			r.Context(), sqlc.SetAdminDisplayNamesParams{
				PrimaryLanguage:   string(request.PrimaryDisplayNameLanguage),
				TargetAdminUserID: identity.UserID,
				LanguageCodes:     languageCodes,
				DisplayNames:      displayNames,
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "set admin display names", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

type missingFieldError string

func (e missingFieldError) Error() string {
	return "missing JSON field " + string(e)
}

func errMissingField(field string) error {
	return missingFieldError(field)
}
