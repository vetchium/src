// Package problem contains RFC 9457 problem details and Vetchium's stable
// problem-type catalog.
package problem

const MediaType = "application/problem+json"

type Details struct {
	Type     string   `json:"type"`
	Title    string   `json:"title"`
	Status   int      `json:"status"`
	Detail   string   `json:"detail,omitempty"`
	Instance string   `json:"instance,omitempty"`
	Fields   []string `json:"fields,omitempty"`
}

var InternalServerError = Details{
	Type:   "vetchium-problem-details/internal-server-error",
	Title:  "Internal Server Error",
	Status: 500,
	Detail: "Server has encountered an error",
}

var InvalidJSONError = Details{
	Type:   "vetchium-problem-details/invalid-json",
	Title:  "Invalid JSON",
	Status: 400,
	Detail: "Request body is not in expected JSON schema",
}

var ValidationFailedError = Details{
	Type:   "vetchium-problem-details/validation-failed",
	Title:  "Validation failed",
	Status: 400,
	Detail: "List of json field names in the request which failed validation",
	Fields: []string{},
}
