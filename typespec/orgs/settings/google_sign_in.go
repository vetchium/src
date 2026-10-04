package settings

type SetGoogleSignInRequest struct {
	Enabled *bool `json:"enabled"`
}

func (r *SetGoogleSignInRequest) Normalize() {}

func (r SetGoogleSignInRequest) Validate() []string {
	if r.Enabled == nil {
		return []string{"enabled"}
	}
	return []string{}
}
