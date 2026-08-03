// Package problem contains RFC 9457 problem details and Vetchium's stable
// problem-type catalog.
package problem

const (
	MediaType               = "application/problem+json"
	TypeAboutBlank          = "about:blank"
	InternalServerErrorBody = `{"type":"about:blank","title":"Internal Server Error","status":500,"detail":"The request could not be completed."}`
)

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
