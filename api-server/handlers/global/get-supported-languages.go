package global

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/global"
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

		response := global.GetSupportedLanguagesResponse{
			Languages: make([]global.SupportedLanguage, 0, len(languages)),
		}

		for _, lang := range languages {
			response.Languages = append(response.Languages, global.SupportedLanguage{
				LanguageCode: lang.LanguageCode,
				LanguageName: lang.LanguageName,
				NativeName:   lang.NativeName,
				IsDefault:    lang.IsDefault,
			})
		}

		json.NewEncoder(w).Encode(response)
	}
}
