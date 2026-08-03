package problem

const (
	TypeRequestBodyTooLarge = "urn:vetchium:problem:request-body-too-large"
	TypeInvalidJSON         = "urn:vetchium:problem:invalid-json"
	TypeInvalidRequest      = "urn:vetchium:problem:invalid-request"

	RequestBodyTooLargeBody = `{"type":"urn:vetchium:problem:request-body-too-large","title":"Request body too large","status":413,"detail":"The request body exceeds the maximum size."}`
	InvalidJSONBody         = `{"type":"urn:vetchium:problem:invalid-json","title":"Invalid JSON","status":400,"detail":"The request body must contain exactly one valid JSON document."}`
	InvalidRequestTitle     = "Invalid request"
	InvalidRequestDetail    = "One or more fields failed validation."
)

type RequestBodyTooLarge = Details

// InvalidJSONDetails is returned when the request body is not exactly one
// valid JSON document.
type InvalidJSONDetails = Details

// InvalidRequestDetails is returned when valid JSON fails request validation.
type InvalidRequestDetails struct {
	Details
	InvalidFields []string `json:"invalid_fields"`
}
