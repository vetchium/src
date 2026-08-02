package problem

import "net/http"

const (
	TypeMalformedRequestBody   = "urn:vetchium:problem:malformed-request-body"
	TypeRequestBodyTooLarge    = "urn:vetchium:problem:request-body-too-large"
	TypeInvalidLoginInput      = "urn:vetchium:problem:invalid-login-input"
	TypeInvalidCredentials     = "urn:vetchium:problem:invalid-credentials"
	TypeAuthenticationRequired = "urn:vetchium:problem:authentication-required"
	TypeInvalidSession         = "urn:vetchium:problem:invalid-session"
)

type MalformedRequestBody = Details

type RequestBodyTooLarge = Details

type InvalidLoginInput = Details

type InvalidCredentials = Details

type AuthenticationRequired = Details

type InvalidSession = Details

func NewMalformedRequestBody() MalformedRequestBody {
	return newDetails(
		TypeMalformedRequestBody,
		"Malformed request body",
		http.StatusBadRequest,
		"The request body must contain one valid JSON object with no unknown fields.",
	)
}

func NewRequestBodyTooLarge() RequestBodyTooLarge {
	return newDetails(
		TypeRequestBodyTooLarge,
		"Request body too large",
		http.StatusRequestEntityTooLarge,
		"The request body exceeds the maximum size.",
	)
}

func NewInvalidLoginInput() InvalidLoginInput {
	return newDetails(
		TypeInvalidLoginInput,
		"Invalid login input",
		http.StatusBadRequest,
		"email_address must be valid and password must not be empty.",
	)
}

func NewInvalidCredentials() InvalidCredentials {
	return newDetails(
		TypeInvalidCredentials,
		"Invalid credentials",
		http.StatusUnauthorized,
		"The email address or password is incorrect.",
	)
}

func NewAuthenticationRequired(detail string) AuthenticationRequired {
	return newDetails(
		TypeAuthenticationRequired,
		"Authentication required",
		http.StatusUnauthorized,
		detail,
	)
}

func NewInvalidSession(detail string) InvalidSession {
	return newDetails(
		TypeInvalidSession,
		"Invalid session",
		http.StatusUnauthorized,
		detail,
	)
}
