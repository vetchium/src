// Package settings holds the handlers of the Org's own settings.
package settings

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	settingsspec "github.com/vetchium/src/typespec/orgs/settings"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/imagesanitize"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

const logoUploadOperation = "orgs:logo:upload"
const logoRemoveOperation = "orgs:logo:remove"

// limits are the Org logo bounds: still JPEG or PNG, each side 128-4096 px,
// at most 2 MiB before and after re-encoding.
var limits = imagesanitize.Limits{
	MaxBytes:     settingsspec.MaxLogoBytes,
	MinDimension: settingsspec.MinLogoDimension,
	MaxLongSide:  settingsspec.MaxLogoDimension,
	MaxShortSide: settingsspec.MaxLogoDimension,
	MaxPixels: int64(settingsspec.MaxLogoDimension) *
		int64(settingsspec.MaxLogoDimension),
}

func UploadLogo(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		if s.Logos == nil {
			s.InternalError(r.Context(), w, "logo storage unavailable", errors.New("missing logo store"))
			return
		}
		contentType := settingsspec.LogoContentType(r.Header.Get("Content-Type"))
		if !settingsspec.IsLogoContentType(contentType) {
			s.Problem(r.Context(), w, orgsproblem.LogoInvalidError)
			return
		}
		if r.ContentLength > settingsspec.MaxLogoBytes {
			s.Problem(r.Context(), w, orgsproblem.LogoTooLargeError)
			return
		}
		// The extra byte distinguishes an exact-limit body from an oversized
		// one without an unbounded read or invoking an image decoder.
		source, err := io.ReadAll(io.LimitReader(r.Body, settingsspec.MaxLogoBytes+1))
		if err != nil {
			s.Problem(r.Context(), w, orgsproblem.LogoInvalidError)
			return
		}
		logo, err := imagesanitize.Sanitize(limits, string(contentType), source)
		if errors.Is(err, imagesanitize.ErrTooLarge) {
			s.Problem(r.Context(), w, orgsproblem.LogoTooLargeError)
			return
		}
		if errors.Is(err, imagesanitize.ErrInvalidImage) {
			s.Problem(r.Context(), w, orgsproblem.LogoInvalidError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "sanitize Org logo", err)
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		digest := requestDigest(contentType, source)
		// A keyed, UUID-shaped identifier lets a retry recover the same staged
		// object after a crash without exposing a guessable storage key.
		objectID := objectIDFor(
			s.CredentialSubkey("logo-object-id"), identity.OrgDID,
			identity.UserID, key,
		)
		replay, apiProblem, err := prepareUpload(
			r.Context(), s, identity, objectID, key, digest, logo,
		)
		if apiProblem != nil {
			s.Problem(r.Context(), w, apiProblem)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "prepare Org logo", err)
			return
		}
		if replay {
			writeUploaded(s, w, r)
			return
		}
		uploadCtx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		err = s.Logos.PutLogo(uploadCtx, objectID, logo)
		cancel()
		if err != nil {
			// The staged row survives. A retry may put the identical bytes, and
			// the deletion worker eventually cleans up an abandoned attempt.
			s.InternalError(r.Context(), w, "store Org logo", err)
			return
		}
		apiProblem, err = activateUpload(r.Context(), s, identity, objectID, key, digest)
		if apiProblem != nil {
			s.Problem(r.Context(), w, apiProblem)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "activate Org logo", err)
			return
		}
		writeUploaded(s, w, r)
	}
}

func writeUploaded(s *orgsruntime.Server, w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	s.Empty(r.Context(), w, http.StatusNoContent)
}

func planRequired() problem.Body {
	return orgsproblem.PlanRequiredError(subscriptionspec.SilverTier)
}

func prepareUpload(
	ctx context.Context, s *orgsruntime.Server, identity middleware.OrgIdentity,
	objectID pgtype.UUID, key common.IdempotencyKey, digest [32]byte,
	logo imagesanitize.Image,
) (bool, problem.Body, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return false, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	lookup := idempotencyLookup(identity, key)
	if err := q.LockIdempotency(ctx, lockID(identity, key)); err != nil {
		return false, nil, err
	}
	if err := q.DeleteExpiredIdempotency(ctx, sqlc.DeleteExpiredIdempotencyParams(lookup)); err != nil {
		return false, nil, err
	}
	stored, err := q.GetIdempotency(ctx, lookup)
	if err == nil {
		if !bytes.Equal(stored.RequestDigest, digest[:]) {
			return false, problem.IdempotencyKeyConflictError, nil
		}
		if stored.ResponseStatus.Valid {
			if stored.ResponseStatus.Int32 != http.StatusNoContent {
				return false, nil, fmt.Errorf("unexpected logo replay status %d", stored.ResponseStatus.Int32)
			}
			return true, nil, tx.Commit(ctx)
		}
	} else if errors.Is(err, pgx.ErrNoRows) {
		if err := q.CreateIdempotency(ctx, sqlc.CreateIdempotencyParams{
			Operation:      logoUploadOperation,
			BindingID:      dbvalue.FormatUUID(identity.UserID),
			IdempotencyKey: string(key),
			RequestDigest:  digest[:],
			ExpiresAt:      dbvalue.Timestamp(s.CurrentTime().Add(24 * time.Hour)),
		}); err != nil {
			return false, nil, err
		}
	} else {
		return false, nil, err
	}
	staged, err := q.GetOrgLogoUpload(ctx, sqlc.GetOrgLogoUploadParams{
		ObjectID: objectID, OrgDid: identity.OrgDID,
	})
	if err == nil {
		if !subscriptionspec.Includes(
			subscriptionspec.PlanOID(staged.OrgPlanOid), subscriptionspec.SilverTier,
		) {
			return false, planRequired(), nil
		}
		if staged.State != sqlc.VetchiumOrgLogoStateUploading ||
			!staged.UploadExpiresAt.Valid ||
			!staged.UploadExpiresAt.Time.After(s.CurrentTime()) {
			return false, orgsproblem.LogoConflictError, nil
		}
		if !bytes.Equal(staged.ContentSha256, logo.SHA256[:]) {
			return false, nil, fmt.Errorf("staged logo digest differs from request")
		}
		return false, nil, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return false, nil, err
	}
	actor := dbvalue.FormatUUID(identity.UserID)
	if _, err := q.SupersedeOrgLogoUploads(ctx, sqlc.SupersedeOrgLogoUploadsParams{
		OrgDid: identity.OrgDID, EntitledPlanOids: entitledPlans(),
		ObjectID: objectID, TenantID: s.TenantID, ActorOrgUserID: actor,
		IdempotencyKey: dbvalue.Text(string(key)),
	}); err != nil {
		return false, nil, err
	}
	format := sqlc.VetchiumOrgLogoFormatJpeg
	if logo.ContentType == imagesanitize.PNG {
		format = sqlc.VetchiumOrgLogoFormatPng
	}
	_, err = q.PrepareOrgLogoUpload(ctx, sqlc.PrepareOrgLogoUploadParams{
		OrgDid: identity.OrgDID, EntitledPlanOids: entitledPlans(),
		ObjectID: objectID, Format: format, ByteSize: int32(len(logo.Bytes)),
		Width: int32(logo.Width), Height: int32(logo.Height),
		ContentSha256: logo.SHA256[:], TenantID: s.TenantID,
		ActorOrgUserID: actor, IdempotencyKey: dbvalue.Text(string(key)),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, planRequired(), nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return false, orgsproblem.LogoConflictError, nil
	}
	if err != nil {
		return false, nil, err
	}
	return false, nil, tx.Commit(ctx)
}

func activateUpload(
	ctx context.Context, s *orgsruntime.Server, identity middleware.OrgIdentity,
	objectID pgtype.UUID, key common.IdempotencyKey, digest [32]byte,
) (problem.Body, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	lookup := idempotencyLookup(identity, key)
	if err := q.LockIdempotency(ctx, lockID(identity, key)); err != nil {
		return nil, err
	}
	stored, err := q.GetIdempotency(ctx, lookup)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(stored.RequestDigest, digest[:]) {
		return problem.IdempotencyKeyConflictError, nil
	}
	if stored.ResponseStatus.Valid {
		if stored.ResponseStatus.Int32 != http.StatusNoContent {
			return nil, fmt.Errorf("unexpected logo replay status %d", stored.ResponseStatus.Int32)
		}
		return nil, tx.Commit(ctx)
	}
	if _, err := q.RetireOrgLogoForReplacement(ctx, sqlc.RetireOrgLogoForReplacementParams{
		OrgDid: identity.OrgDID, EntitledPlanOids: entitledPlans(), ObjectID: objectID,
	}); err != nil {
		return nil, err
	}
	staged, err := q.GetOrgLogoUpload(ctx, sqlc.GetOrgLogoUploadParams{
		ObjectID: objectID, OrgDid: identity.OrgDID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return orgsproblem.LogoConflictError, nil
	}
	if err != nil {
		return nil, err
	}
	if !subscriptionspec.Includes(
		subscriptionspec.PlanOID(staged.OrgPlanOid), subscriptionspec.SilverTier,
	) {
		return planRequired(), nil
	}
	if staged.State != sqlc.VetchiumOrgLogoStateUploading ||
		!staged.UploadExpiresAt.Valid ||
		!staged.UploadExpiresAt.Time.After(s.CurrentTime()) {
		return orgsproblem.LogoConflictError, nil
	}
	if _, err := q.ActivateOrgLogo(ctx, sqlc.ActivateOrgLogoParams{
		OrgDid: identity.OrgDID, EntitledPlanOids: entitledPlans(),
		ObjectID: objectID, TenantID: s.TenantID,
		ActorOrgUserID: dbvalue.FormatUUID(identity.UserID),
		IdempotencyKey: dbvalue.Text(string(key)),
	}); errors.Is(err, pgx.ErrNoRows) {
		return orgsproblem.LogoConflictError, nil
	} else if err != nil {
		return nil, err
	}
	ciphertext, err := s.EncryptIdempotency([]byte("{}"))
	if err != nil {
		return nil, err
	}
	if err := q.CompleteIdempotency(ctx, sqlc.CompleteIdempotencyParams{
		Operation: logoUploadOperation, BindingID: dbvalue.FormatUUID(identity.UserID),
		IdempotencyKey:     string(key),
		ResponseStatus:     pgtype.Int4{Int32: http.StatusNoContent, Valid: true},
		ResponseCiphertext: ciphertext,
	}); err != nil {
		return nil, err
	}
	return nil, tx.Commit(ctx)
}

func RemoveLogo(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		handlerauth.RunIdempotent(
			s, w, r, logoRemoveOperation,
			dbvalue.FormatUUID(identity.UserID), key, struct{}{},
			s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[struct{}], *handlerauth.Problem, error,
			) {
				_, err := q.RemoveOrgLogo(r.Context(), sqlc.RemoveOrgLogoParams{
					OrgDid: identity.OrgDID, TenantID: s.TenantID,
					ActorOrgUserID: dbvalue.FormatUUID(identity.UserID),
					IdempotencyKey: dbvalue.Text(string(key)),
				})
				if err != nil && !errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				return handlerauth.Result[struct{}]{
					Status: http.StatusNoContent,
				}, nil, nil
			},
		)
	}
}

func idempotencyLookup(identity middleware.OrgIdentity, key common.IdempotencyKey) sqlc.GetIdempotencyParams {
	return sqlc.GetIdempotencyParams{
		Operation: logoUploadOperation, BindingID: dbvalue.FormatUUID(identity.UserID),
		IdempotencyKey: string(key),
	}
}

func entitledPlans() []string {
	plans := subscriptionspec.PlansAtOrAbove(subscriptionspec.SilverTier)
	oids := make([]string, 0, len(plans))
	for _, plan := range plans {
		oids = append(oids, string(plan))
	}
	return oids
}

func lockID(identity middleware.OrgIdentity, key common.IdempotencyKey) string {
	return logoUploadOperation + ":" + dbvalue.FormatUUID(identity.UserID) + ":" + string(key)
}

func requestDigest(contentType settingsspec.LogoContentType, source []byte) [32]byte {
	hash := sha256.New()
	_, _ = hash.Write([]byte(contentType))
	_, _ = hash.Write([]byte{0})
	_, _ = hash.Write(source)
	var digest [32]byte
	copy(digest[:], hash.Sum(nil))
	return digest
}

func objectIDFor(
	secret [32]byte, orgDID, userID pgtype.UUID, key common.IdempotencyKey,
) pgtype.UUID {
	mac := hmac.New(sha256.New, secret[:])
	_, _ = mac.Write(orgDID.Bytes[:])
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write(userID.Bytes[:])
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(key))
	sum := mac.Sum(nil)
	var id pgtype.UUID
	copy(id.Bytes[:], sum[:16])
	id.Bytes[6] = (id.Bytes[6] & 0x0f) | 0x40
	id.Bytes[8] = (id.Bytes[8] & 0x3f) | 0x80
	id.Valid = true
	return id
}
