package auth

const (
	BearerChallenge        = `Bearer realm="hub"`
	LoginChallenge         = `VetchiumLogin realm="hub"`
	LoginTokenChallenge    = `VetchiumLoginChallenge realm="hub"`
	SignupChallenge        = `VetchiumSignup realm="hub"`
	PasswordResetChallenge = `VetchiumPasswordReset realm="hub"`
)
