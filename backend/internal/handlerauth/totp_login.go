package handlerauth

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

// IssuedSession is the session a second factor produced. ExpiresAt is what the
// database committed, which may differ from the expiry the flow asked for.
type IssuedSession struct {
	Token     string
	ExpiresAt time.Time
}

// SecondFactorLogin completes a login that is waiting on a second factor. It
// is generic over the portal's login-challenge row because only the portal
// knows which of its columns the completion query and the response need.
type SecondFactorLogin[Challenge any] struct {
	// TokenHash identifies the pending login challenge.
	TokenHash []byte

	// SessionDuration can depend on the challenge, because a portal may let
	// the user ask for a remembered session before the second factor runs.
	SessionDuration func(Challenge) time.Duration
	Now             time.Time
	Problems        TOTPProblems

	// Challenge returns pgx.ErrNoRows when no live challenge matches. It must
	// take the credential lock for the challenge's principal before reading,
	// so a concurrent credential change cannot interleave.
	Challenge func(
		context.Context, *sqlc.Queries, []byte,
	) (Challenge, error)
}

// challenge resolves the pending login challenge, mapping a missing one to the
// portal's invalid-challenge problem.
func (f SecondFactorLogin[Challenge]) challenge(
	ctx context.Context, q *sqlc.Queries,
) (Challenge, *Problem, error) {
	challenge, err := f.Challenge(ctx, q, f.TokenHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return challenge, &Problem{
			Details:         f.Problems.InvalidLoginChallenge,
			WWWAuthenticate: f.Problems.LoginChallenge,
		}, nil
	}
	return challenge, nil, err
}

// VerifyTOTPLogin checks a TOTP code against the challenge's enrolled secret
// and issues a session.
func VerifyTOTPLogin[Challenge, Body any](
	ctx context.Context, q *sqlc.Queries,
	flow SecondFactorLogin[Challenge],
	secretKey [32]byte, code string,
	secretCiphertext func(Challenge) []byte,
	complete func(
		context.Context, *sqlc.Queries, Challenge, CompletedTOTPLogin,
	) (pgtype.Timestamptz, error),
	body func(Challenge, IssuedSession) Body,
) (Result[Body], *Problem, error) {
	challenge, apiProblem, err := flow.challenge(ctx, q)
	if apiProblem != nil || err != nil {
		return Result[Body]{}, apiProblem, err
	}
	secret, err := credentials.Decrypt(secretKey, secretCiphertext(challenge))
	if err != nil {
		return Result[Body]{}, nil, err
	}
	timestep, valid := credentials.VerifyTOTP(string(secret), code, flow.Now)
	if !valid {
		return Failure[Body](flow.Problems.IncorrectTOTPCode)
	}
	token, tokenHash, err := credentials.NewToken()
	if err != nil {
		return Result[Body]{}, nil, err
	}
	expiresAt := flow.Now.Add(flow.SessionDuration(challenge))
	committed, err := complete(ctx, q, challenge, CompletedTOTPLogin{
		Timestep:         dbvalue.Int64(timestep),
		SessionTokenHash: tokenHash,
		ExpiresAt:        dbvalue.Timestamp(expiresAt),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Failure[Body](flow.Problems.IncorrectTOTPCode)
	}
	if err != nil {
		return Result[Body]{}, nil, err
	}
	if committed.Valid {
		expiresAt = committed.Time
	}
	return Result[Body]{
		Status: http.StatusOK,
		Body: body(challenge, IssuedSession{
			Token: token, ExpiresAt: expiresAt,
		}),
	}, nil, nil
}

// CompletedTOTPLogin is what a portal stores when a TOTP login succeeds.
type CompletedTOTPLogin struct {
	Timestep         pgtype.Int8
	SessionTokenHash []byte
	ExpiresAt        pgtype.Timestamptz
}

// CompletedRecoveryCodeLogin is what a portal stores when a recovery code is
// spent to sign in.
type CompletedRecoveryCodeLogin struct {
	RecoveryCodeHash []byte
	SessionTokenHash []byte
	ExpiresAt        pgtype.Timestamptz
}

// SpentRecoveryCode reports what the completion query committed.
type SpentRecoveryCode struct {
	ExpiresAt      pgtype.Timestamptz
	RemainingCodes int64
}

// VerifyRecoveryCodeLogin spends one recovery code to complete a login.
func VerifyRecoveryCodeLogin[Challenge, Body any](
	ctx context.Context, q *sqlc.Queries,
	flow SecondFactorLogin[Challenge], code string,
	complete func(
		context.Context, *sqlc.Queries, Challenge, CompletedRecoveryCodeLogin,
	) (SpentRecoveryCode, error),
	body func(Challenge, IssuedSession, int64) Body,
) (Result[Body], *Problem, error) {
	challenge, apiProblem, err := flow.challenge(ctx, q)
	if apiProblem != nil || err != nil {
		return Result[Body]{}, apiProblem, err
	}
	token, tokenHash, err := credentials.NewToken()
	if err != nil {
		return Result[Body]{}, nil, err
	}
	expiresAt := flow.Now.Add(flow.SessionDuration(challenge))
	spent, err := complete(ctx, q, challenge, CompletedRecoveryCodeLogin{
		RecoveryCodeHash: credentials.RecoveryCodeHash(code),
		SessionTokenHash: tokenHash,
		ExpiresAt:        dbvalue.Timestamp(expiresAt),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Failure[Body](flow.Problems.IncorrectRecoveryCode)
	}
	if err != nil {
		return Result[Body]{}, nil, err
	}
	if spent.ExpiresAt.Valid {
		expiresAt = spent.ExpiresAt.Time
	}
	return Result[Body]{
		Status: http.StatusOK,
		Body: body(
			challenge,
			IssuedSession{Token: token, ExpiresAt: expiresAt},
			spent.RemainingCodes,
		),
	}, nil, nil
}
