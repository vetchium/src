// Package problem contains RFC 9457 problem details and Vetchium's stable
// problem-type catalog.
package problem

import "net/http"

const TypeAboutBlank = "about:blank"

// Details is the RFC 9457 problem-details representation used by Vetchium
// APIs. Type, Title, and Status are always emitted so clients do not need to
// supply RFC defaults.
type Details struct {
	Type     string `json:"type"`
	Title    string `json:"title"`
	Status   int    `json:"status"`
	Detail   string `json:"detail,omitempty"`
	Instance string `json:"instance,omitempty"`
}

type InternalServerError = Details

// New creates an about:blank problem for a standard HTTP status.
func New(status int, detail string) Details {
	return newDetails(TypeAboutBlank, http.StatusText(status), status, detail)
}

func NewInternalServerError() InternalServerError {
	return New(http.StatusInternalServerError, "The request could not be completed.")
}

func newDetails(typeURI, title string, status int, detail string) Details {
	return Details{
		Type:   typeURI,
		Title:  title,
		Status: status,
		Detail: detail,
	}
}
