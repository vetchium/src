package auth

const (
	BearerChallenge        = `Bearer realm="orgs"`
	LoginChallenge         = `VetchiumLogin realm="orgs"`
	LoginTokenChallenge    = `VetchiumLoginChallenge realm="orgs"`
	SignupChallenge        = `VetchiumSignup realm="orgs"`
	PasswordResetChallenge = `VetchiumPasswordReset realm="orgs"`
	InvitationChallenge    = `VetchiumInvitation realm="orgs"`
)
