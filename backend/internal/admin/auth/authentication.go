package auth

// Scheme names identify credential kinds; the realm identifies the portal.
const (
	BearerChallenge        = `Bearer realm="admin"`
	LoginChallenge         = `VetchiumLogin realm="admin"`
	LoginTokenChallenge    = `VetchiumLoginChallenge realm="admin"`
	InvitationChallenge    = `VetchiumInvitation realm="admin"`
	PasswordResetChallenge = `VetchiumPasswordReset realm="admin"`
)
