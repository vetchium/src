package problem

const (
	TypeInvalidJSON    = "urn:vetchium:problem:invalid-json"
	TypeInvalidRequest = "urn:vetchium:problem:invalid-request"

	InvalidRequestTitle  = "Invalid request"
	InvalidRequestDetail = "One or more fields failed validation."
)

// InvalidJSONDetails is returned when the request body cannot be decoded.
type InvalidJSONDetails = Details

// InvalidRequestDetails is returned when valid JSON fails request validation.
type InvalidRequestDetails struct {
	Details
	InvalidFields []string `json:"invalid_fields"`
}
