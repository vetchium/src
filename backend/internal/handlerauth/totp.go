package handlerauth

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

// TOTPEnrollmentTTL is how long an unconfirmed enrollment stays usable. It
// bounds how long a provisioning secret sits in a user's authenticator app
// without ever being proved.
const TOTPEnrollmentTTL = 10 * time.Minute

// RecoveryCodeReplayWindow is how long a regenerated set of recovery codes
// stays replayable. It has to outlive an interrupted response without keeping
// the codes retrievable afterwards.
const RecoveryCodeReplayWindow = 5 * time.Minute

// TOTPProblems is one portal's vocabulary for the shared TOTP flows. Every
// flow below decides which problem applies; the portal only supplies the
// values and the challenge that names it.
type TOTPProblems struct {
	InvalidLoginChallenge problem.Details
	IncorrectTOTPCode     problem.Details
	IncorrectRecoveryCode problem.Details
	TOTPAlreadyEnabled    problem.Details
	TOTPNotEnabled        problem.Details
	InvalidEnrollment     problem.Details
	AuthenticationFailed  problem.Details

	LoginChallenge  string
	BearerChallenge string
}

// SubjectLock serializes credential replacement for one principal.
type SubjectLock func(context.Context, *sqlc.Queries, pgtype.UUID) error

// CreatedTOTPEnrollment is the row a portal's enrollment insert returns. An
// unset ExpiresAt means the portal's query did not report one, so the flow
// keeps the expiry it asked for.
type CreatedTOTPEnrollment struct {
	ExpiresAt pgtype.Timestamptz
}

// TOTPEnrollmentRequest is what a portal stores when enrollment starts.
type TOTPEnrollmentRequest struct {
	Subject          pgtype.UUID
	TokenHash        []byte
	SecretCiphertext []byte
	ExpiresAt        time.Time
	TenantID         string
	IdempotencyKey   pgtype.Text
}

// StartTOTPEnrollmentFlow issues an enrollment secret for one principal.
type StartTOTPEnrollmentFlow struct {
	Subject        pgtype.UUID
	TenantID       string
	IdempotencyKey common.IdempotencyKey
	SecretKey      [32]byte
	Issuer         string
	ExpiresAt      time.Time
	Problems       TOTPProblems

	Lock SubjectLock

	// Create returns pgx.ErrNoRows when TOTP is already enabled.
	Create func(
		context.Context, *sqlc.Queries, TOTPEnrollmentRequest,
	) (CreatedTOTPEnrollment, error)
}

// StartedTOTPEnrollment is what the portal turns into its own response.
type StartedTOTPEnrollment struct {
	Token           string
	Secret          string
	ProvisioningURI string
	ExpiresAt       time.Time
}

func StartTOTPEnrollment[Body any](
	ctx context.Context, q *sqlc.Queries,
	flow StartTOTPEnrollmentFlow, body func(StartedTOTPEnrollment) Body,
) (Result[Body], *Problem, error) {
	if err := flow.Lock(ctx, q, flow.Subject); err != nil {
		return Result[Body]{}, nil, err
	}
	secret, err := credentials.NewTOTPSecret()
	if err != nil {
		return Result[Body]{}, nil, err
	}
	ciphertext, err := credentials.Encrypt(flow.SecretKey, []byte(secret))
	if err != nil {
		return Result[Body]{}, nil, err
	}
	token, tokenHash, err := credentials.NewToken()
	if err != nil {
		return Result[Body]{}, nil, err
	}
	created, err := flow.Create(ctx, q, TOTPEnrollmentRequest{
		Subject:          flow.Subject,
		TokenHash:        tokenHash,
		SecretCiphertext: ciphertext,
		ExpiresAt:        flow.ExpiresAt,
		TenantID:         flow.TenantID,
		IdempotencyKey:   dbvalue.Text(string(flow.IdempotencyKey)),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Failure[Body](flow.Problems.TOTPAlreadyEnabled)
	}
	if err != nil {
		return Result[Body]{}, nil, err
	}
	expiresAt := flow.ExpiresAt
	if created.ExpiresAt.Valid {
		expiresAt = created.ExpiresAt.Time
	}
	subject := dbvalue.FormatUUID(flow.Subject)
	return Result[Body]{
		Status: http.StatusOK,
		Body: body(StartedTOTPEnrollment{
			Token:  token,
			Secret: secret,
			ProvisioningURI: credentials.TOTPProvisioningURI(
				subject, flow.Issuer, secret,
			),
			ExpiresAt: expiresAt,
		}),
	}, nil, nil
}

// PendingTOTPEnrollment is the stored enrollment a confirmation checks against.
type PendingTOTPEnrollment struct {
	EnrollmentID     pgtype.UUID
	SecretCiphertext []byte
}

// ConfirmedTOTPEnrollment is what a portal stores when enrollment succeeds.
type ConfirmedTOTPEnrollment struct {
	EnrollmentID       pgtype.UUID
	Subject            pgtype.UUID
	SecretCiphertext   []byte
	Timestep           pgtype.Int8
	RecoveryCodeHashes [][]byte
	TenantID           string
	IdempotencyKey     pgtype.Text
}

// ConfirmTOTPEnrollmentFlow proves possession of the enrolled secret and turns
// it into the principal's active TOTP credential.
type ConfirmTOTPEnrollmentFlow struct {
	Subject        pgtype.UUID
	TokenHash      []byte
	Code           string
	Now            time.Time
	TenantID       string
	IdempotencyKey common.IdempotencyKey
	SecretKey      [32]byte
	Problems       TOTPProblems

	Lock SubjectLock

	// Enrollment returns pgx.ErrNoRows when no live enrollment matches.
	Enrollment func(
		context.Context, *sqlc.Queries, []byte, pgtype.UUID,
	) (PendingTOTPEnrollment, error)

	// Confirm reports whether the enrollment was still live when it committed.
	Confirm func(
		context.Context, *sqlc.Queries, ConfirmedTOTPEnrollment,
	) (bool, error)
}

func ConfirmTOTPEnrollment[Body any](
	ctx context.Context, q *sqlc.Queries,
	flow ConfirmTOTPEnrollmentFlow, body func([]common.TOTPRecoveryCode) Body,
) (Result[Body], *Problem, error) {
	if err := flow.Lock(ctx, q, flow.Subject); err != nil {
		return Result[Body]{}, nil, err
	}
	enrollment, err := flow.Enrollment(ctx, q, flow.TokenHash, flow.Subject)
	if errors.Is(err, pgx.ErrNoRows) {
		return Failure[Body](flow.Problems.InvalidEnrollment)
	}
	if err != nil {
		return Result[Body]{}, nil, err
	}
	secret, err := credentials.Decrypt(
		flow.SecretKey, enrollment.SecretCiphertext,
	)
	if err != nil {
		return Result[Body]{}, nil, err
	}
	timestep, valid := credentials.VerifyTOTP(
		string(secret), flow.Code, flow.Now,
	)
	if !valid {
		return Failure[Body](flow.Problems.IncorrectTOTPCode)
	}
	codes, hashes, err := credentials.NewRecoveryCodes()
	if err != nil {
		return Result[Body]{}, nil, err
	}
	confirmed, err := flow.Confirm(ctx, q, ConfirmedTOTPEnrollment{
		EnrollmentID:       enrollment.EnrollmentID,
		Subject:            flow.Subject,
		SecretCiphertext:   enrollment.SecretCiphertext,
		Timestep:           dbvalue.Int64(timestep),
		RecoveryCodeHashes: hashes,
		TenantID:           flow.TenantID,
		IdempotencyKey:     dbvalue.Text(string(flow.IdempotencyKey)),
	})
	if err != nil {
		return Result[Body]{}, nil, err
	}
	if !confirmed {
		return Failure[Body](flow.Problems.InvalidEnrollment)
	}
	return Result[Body]{
		Status: http.StatusOK, Body: body(wireRecoveryCodes(codes)),
	}, nil, nil
}

// RegenerateRecoveryCodesFlow replaces every unused recovery code.
type RegenerateRecoveryCodesFlow struct {
	Subject        pgtype.UUID
	TenantID       string
	IdempotencyKey common.IdempotencyKey
	Problems       TOTPProblems

	Lock SubjectLock

	// Enabled returns pgx.ErrNoRows when the principal has no TOTP credential.
	Enabled func(context.Context, *sqlc.Queries, pgtype.UUID) (bool, error)

	// Regenerate reports whether TOTP was still enabled when it committed.
	Regenerate func(
		context.Context, *sqlc.Queries, RegeneratedRecoveryCodes,
	) (bool, error)
}

// RegeneratedRecoveryCodes is what a portal stores when codes are replaced.
type RegeneratedRecoveryCodes struct {
	Subject            pgtype.UUID
	RecoveryCodeHashes [][]byte
	TenantID           string
	IdempotencyKey     pgtype.Text
}

func RegenerateRecoveryCodes[Body any](
	ctx context.Context, q *sqlc.Queries,
	flow RegenerateRecoveryCodesFlow, body func([]common.TOTPRecoveryCode) Body,
) (Result[Body], *Problem, error) {
	// The lock and the enabled check run before new codes are generated, so a
	// concurrent disable cannot interleave between the check and the write.
	if err := flow.Lock(ctx, q, flow.Subject); err != nil {
		return Result[Body]{}, nil, err
	}
	enabled, err := flow.Enabled(ctx, q, flow.Subject)
	if errors.Is(err, pgx.ErrNoRows) {
		return Failure[Body](flow.Problems.TOTPNotEnabled)
	}
	if err != nil {
		return Result[Body]{}, nil, err
	}
	if !enabled {
		return Failure[Body](flow.Problems.TOTPNotEnabled)
	}
	codes, hashes, err := credentials.NewRecoveryCodes()
	if err != nil {
		return Result[Body]{}, nil, err
	}
	regenerated, err := flow.Regenerate(ctx, q, RegeneratedRecoveryCodes{
		Subject:            flow.Subject,
		RecoveryCodeHashes: hashes,
		TenantID:           flow.TenantID,
		IdempotencyKey:     dbvalue.Text(string(flow.IdempotencyKey)),
	})
	if err != nil {
		return Result[Body]{}, nil, err
	}
	if !regenerated {
		return Failure[Body](flow.Problems.TOTPNotEnabled)
	}
	return Result[Body]{
		Status: http.StatusOK, Body: body(wireRecoveryCodes(codes)),
	}, nil, nil
}

func wireRecoveryCodes(codes []string) []common.TOTPRecoveryCode {
	wire := make([]common.TOTPRecoveryCode, len(codes))
	for index, code := range codes {
		wire[index] = common.TOTPRecoveryCode(code)
	}
	return wire
}
