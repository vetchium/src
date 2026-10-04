package profile

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
	profilespec "github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/hub/subscriptions"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
	"backend/internal/profilepicture"
)

const pictureUploadOperation = "hub:profile:upload-picture"

//vetchium:multiple-commits stages the picture, stores its bytes in object storage, then activates it
func UploadPicture(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		if s.Pictures == nil {
			s.InternalError(r.Context(), w, "picture storage unavailable", errors.New("missing picture store"))
			return
		}
		contentType := profilespec.PictureContentType(r.Header.Get("Content-Type"))
		if !profilespec.IsPictureContentType(contentType) {
			s.Problem(r.Context(), w, hubproblem.ProfilePictureInvalidError)
			return
		}
		if r.ContentLength > profilespec.MaxPictureBytes {
			s.Problem(r.Context(), w, hubproblem.ProfilePictureTooLargeError)
			return
		}
		// The extra byte distinguishes an exact-limit body from an oversized one
		// without allowing an unbounded read or invoking an image decoder.
		source, err := io.ReadAll(io.LimitReader(r.Body, profilespec.MaxPictureBytes+1))
		if err != nil {
			s.Problem(r.Context(), w, hubproblem.ProfilePictureInvalidError)
			return
		}
		picture, err := profilepicture.Sanitize(contentType, source)
		if errors.Is(err, profilepicture.ErrTooLarge) {
			s.Problem(r.Context(), w, hubproblem.ProfilePictureTooLargeError)
			return
		}
		if errors.Is(err, profilepicture.ErrInvalidImage) {
			s.Problem(r.Context(), w, hubproblem.ProfilePictureInvalidError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "sanitize profile picture", err)
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		digest := pictureRequestDigest(contentType, source)
		// A keyed, UUID-shaped identifier lets a retry recover the same staged
		// object after a crash without exposing a guessable storage key.
		objectID := pictureObjectID(
			s.CredentialSubkey("picture-object-id"), identity.UserDID, key,
		)
		replay, apiProblem, err := preparePictureUpload(
			r.Context(), s, identity.UserDID, objectID, key, digest, picture,
		)
		if apiProblem != nil {
			s.Problem(r.Context(), w, apiProblem)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "prepare profile picture", err)
			return
		}
		if replay {
			writePictureUploaded(s, w, r)
			return
		}
		uploadCtx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		err = s.Pictures.Put(uploadCtx, objectID, picture)
		cancel()
		if err != nil {
			// The staged row survives. A retry may put the identical bytes, and
			// the deletion worker eventually cleans up an abandoned attempt.
			s.InternalError(r.Context(), w, "store profile picture", err)
			return
		}
		apiProblem, err = activatePictureUpload(
			r.Context(), s, identity.UserDID, objectID, key, digest,
		)
		if apiProblem != nil {
			s.Problem(r.Context(), w, apiProblem)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "activate profile picture", err)
			return
		}
		writePictureUploaded(s, w, r)
	}
}

func writePictureUploaded(s *hubruntime.Server, w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	s.Empty(r.Context(), w, http.StatusNoContent)
}

func preparePictureUpload(
	ctx context.Context, s *hubruntime.Server, did, objectID pgtype.UUID,
	key common.IdempotencyKey, digest [32]byte, picture profilepicture.Sanitized,
) (bool, problem.Body, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return false, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	lookup := pictureIdempotencyLookup(did, key)
	if err := q.LockIdempotency(ctx, pictureLockID(did, key)); err != nil {
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
				return false, nil, fmt.Errorf("unexpected picture replay status %d", stored.ResponseStatus.Int32)
			}
			return true, nil, tx.Commit(ctx)
		}
	} else if errors.Is(err, pgx.ErrNoRows) {
		if err := q.CreateIdempotency(ctx, sqlc.CreateIdempotencyParams{
			Operation:      pictureUploadOperation,
			BindingID:      dbvalue.FormatUUID(did),
			IdempotencyKey: string(key),
			RequestDigest:  digest[:],
			ExpiresAt:      dbvalue.Timestamp(s.CurrentTime().Add(24 * time.Hour)),
		}); err != nil {
			return false, nil, err
		}
	} else {
		return false, nil, err
	}
	staged, err := q.GetHubProfilePictureUpload(ctx,
		sqlc.GetHubProfilePictureUploadParams{
			ObjectID: objectID, HubUserDid: did,
		})
	if err == nil {
		if !subscriptions.Includes(subscriptions.PlanOID(staged.HubPlanOid), subscriptions.SilverTier) {
			return false, hubproblem.PlanRequiredError(subscriptions.SilverTier), nil
		}
		if staged.State != sqlc.VetchiumHubProfilePictureStateUploading ||
			!staged.UploadExpiresAt.Valid ||
			!staged.UploadExpiresAt.Time.After(s.CurrentTime()) {
			return false, hubproblem.ProfileConflictError, nil
		}
		if !bytes.Equal(staged.ContentSha256, picture.SHA256[:]) {
			return false, nil, fmt.Errorf("staged picture digest differs from request")
		}
		return false, nil, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return false, nil, err
	}
	if _, err := q.SupersedeHubProfilePictureUploads(ctx,
		sqlc.SupersedeHubProfilePictureUploadsParams{
			HubUserDid: did, EntitledPlanOids: entitledPicturePlans(),
			ObjectID: objectID, TenantID: s.TenantID,
			IdempotencyKey: dbvalue.Text(string(key)),
		}); err != nil {
		return false, nil, err
	}
	format := sqlc.VetchiumHubProfilePictureFormatJpeg
	if picture.ContentType == profilespec.PicturePNG {
		format = sqlc.VetchiumHubProfilePictureFormatPng
	}
	_, err = q.PrepareHubProfilePictureUpload(ctx,
		sqlc.PrepareHubProfilePictureUploadParams{
			HubUserDid: did, EntitledPlanOids: entitledPicturePlans(),
			ObjectID: objectID, Format: format,
			ByteSize: int32(len(picture.Bytes)), Width: int32(picture.Width),
			Height: int32(picture.Height), ContentSha256: picture.SHA256[:],
			TenantID: s.TenantID, IdempotencyKey: dbvalue.Text(string(key)),
		})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, hubproblem.PlanRequiredError(subscriptions.SilverTier), nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return false, hubproblem.ProfileConflictError, nil
	}
	if err != nil {
		return false, nil, err
	}
	return false, nil, tx.Commit(ctx)
}

func activatePictureUpload(
	ctx context.Context, s *hubruntime.Server, did, objectID pgtype.UUID,
	key common.IdempotencyKey, digest [32]byte,
) (problem.Body, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	lookup := pictureIdempotencyLookup(did, key)
	if err := q.LockIdempotency(ctx, pictureLockID(did, key)); err != nil {
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
			return nil, fmt.Errorf("unexpected picture replay status %d", stored.ResponseStatus.Int32)
		}
		return nil, tx.Commit(ctx)
	}
	if _, err := q.RetireHubProfilePictureForReplacement(ctx,
		sqlc.RetireHubProfilePictureForReplacementParams{
			HubUserDid: did, EntitledPlanOids: entitledPicturePlans(),
			ObjectID: objectID,
		}); err != nil {
		return nil, err
	}
	staged, err := q.GetHubProfilePictureUpload(ctx,
		sqlc.GetHubProfilePictureUploadParams{
			ObjectID: objectID, HubUserDid: did,
		})
	if errors.Is(err, pgx.ErrNoRows) {
		return hubproblem.ProfileConflictError, nil
	}
	if err != nil {
		return nil, err
	}
	if !subscriptions.Includes(subscriptions.PlanOID(staged.HubPlanOid), subscriptions.SilverTier) {
		return hubproblem.PlanRequiredError(subscriptions.SilverTier), nil
	}
	if staged.State != sqlc.VetchiumHubProfilePictureStateUploading ||
		!staged.UploadExpiresAt.Valid ||
		!staged.UploadExpiresAt.Time.After(s.CurrentTime()) {
		return hubproblem.ProfileConflictError, nil
	}
	if _, err := q.ActivateHubProfilePicture(ctx,
		sqlc.ActivateHubProfilePictureParams{
			HubUserDid: did, EntitledPlanOids: entitledPicturePlans(),
			ObjectID: objectID, TenantID: s.TenantID,
			IdempotencyKey: dbvalue.Text(string(key)),
		}); errors.Is(err, pgx.ErrNoRows) {
		return hubproblem.ProfileConflictError, nil
	} else if err != nil {
		return nil, err
	}
	ciphertext, err := s.EncryptIdempotency([]byte("{}"))
	if err != nil {
		return nil, err
	}
	if err := q.CompleteIdempotency(ctx, sqlc.CompleteIdempotencyParams{
		Operation: pictureUploadOperation, BindingID: dbvalue.FormatUUID(did),
		IdempotencyKey:     string(key),
		ResponseStatus:     pgtype.Int4{Int32: http.StatusNoContent, Valid: true},
		ResponseCiphertext: ciphertext,
	}); err != nil {
		return nil, err
	}
	return nil, tx.Commit(ctx)
}

func pictureIdempotencyLookup(did pgtype.UUID, key common.IdempotencyKey) sqlc.GetIdempotencyParams {
	return sqlc.GetIdempotencyParams{
		Operation: pictureUploadOperation, BindingID: dbvalue.FormatUUID(did),
		IdempotencyKey: string(key),
	}
}

func entitledPicturePlans() []string {
	plans := subscriptions.PlansAtOrAbove(subscriptions.SilverTier)
	oids := make([]string, 0, len(plans))
	for _, plan := range plans {
		oids = append(oids, string(plan))
	}
	return oids
}

func pictureLockID(did pgtype.UUID, key common.IdempotencyKey) string {
	return pictureUploadOperation + ":" + dbvalue.FormatUUID(did) + ":" + string(key)
}

func pictureRequestDigest(contentType profilespec.PictureContentType, source []byte) [32]byte {
	hash := sha256.New()
	_, _ = hash.Write([]byte(contentType))
	_, _ = hash.Write([]byte{0})
	_, _ = hash.Write(source)
	var digest [32]byte
	copy(digest[:], hash.Sum(nil))
	return digest
}

func pictureObjectID(secret [32]byte, did pgtype.UUID, key common.IdempotencyKey) pgtype.UUID {
	mac := hmac.New(sha256.New, secret[:])
	_, _ = mac.Write(did.Bytes[:])
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
