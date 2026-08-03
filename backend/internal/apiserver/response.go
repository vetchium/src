package apiserver

import (
	"encoding/json"
	"net/http"

	problemspec "github.com/vetchium/src/typespec/problem"
)

var internalErr = problemspec.InternalServerError{
	Type:   problemspec.TypeAboutBlank,
	Title:  "Internal Server Error",
	Status: http.StatusInternalServerError,
	Detail: "The request could not be completed.",
}

var malformedJSON = problemspec.InvalidJSONDetails{
	Type:   problemspec.TypeInvalidJSON,
	Title:  "Invalid JSON",
	Status: http.StatusBadRequest,
	Detail: "The request body must contain valid JSON matching the request schema.",
}

func (s *Runtime) InternalError(w http.ResponseWriter) {
	w.Header().Set("Content-Type", problemspec.MediaType)
	w.WriteHeader(http.StatusInternalServerError)
	if err := json.NewEncoder(w).Encode(internalErr); err != nil {
		s.Error("encode internal error response", "error", err)
	}
}

func (s *Runtime) MalformedJSON(w http.ResponseWriter) {
	w.Header().Set("Content-Type", problemspec.MediaType)
	w.WriteHeader(http.StatusBadRequest)
	if err := json.NewEncoder(w).Encode(malformedJSON); err != nil {
		s.Error("encode malformed JSON response", "error", err)
	}
}

func (s *Runtime) InvalidRequest(w http.ResponseWriter, invalidFields []string) {
	w.Header().Set("Content-Type", problemspec.MediaType)
	w.WriteHeader(http.StatusBadRequest)
	if err := json.NewEncoder(w).Encode(problemspec.InvalidRequestDetails{
		Details: problemspec.Details{
			Type:   problemspec.TypeInvalidRequest,
			Title:  problemspec.InvalidRequestTitle,
			Status: http.StatusBadRequest,
			Detail: problemspec.InvalidRequestDetail,
		},
		InvalidFields: invalidFields,
	}); err != nil {
		s.Error("encode invalid request response", "error", err)
	}
}
