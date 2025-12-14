package hub

type EmailAddress string
type Password string

type HubLoginRequest struct {
	EmailAddress EmailAddress `json:"email_address"`
	Password     Password     `json:"password"`
}

type HubLoginResponse struct {
	Token string `json:"token"`
}
