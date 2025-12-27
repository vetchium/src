package hub

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/hub"
)

func GetSupportedLanguages(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		languages, err := s.Global.GetSupportedLanguages(ctx)
		if err != nil {
			log.Error("failed to query supported languages", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		response := hub.GetSupportedLanguagesResponse{
			Languages: make([]hub.SupportedLanguage, 0, len(languages)),
		}

		for _, lang := range languages {
			response.Languages = append(response.Languages, hub.SupportedLanguage{
				LanguageCode: lang.LanguageCode,
				LanguageName: lang.LanguageName,
				NativeName:   lang.NativeName,
				IsDefault:    lang.IsDefault,
			})
		}

		json.NewEncoder(w).Encode(response)
	}
}
