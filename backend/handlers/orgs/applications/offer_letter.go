package applications

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

const offerLetterUploadOperation = "orgs:upload-offer-letter"

// UploadOfferLetter stores a PDF letter for the caller's next offer
// (agent-guides/object-storage.md, Offer letters).
//
//vetchium:multiple-commits stages the letter, stores its bytes in object storage, then marks it uploaded
func UploadOfferLetter(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		if s.OfferLetters == nil {
			s.InternalError(r.Context(), w, "offer letter storage unavailable",
				errors.New("missing offer letter store"))
			return
		}
		mediaType := strings.TrimSpace(strings.Split(
			r.Header.Get("Content-Type"), ";",
		)[0])
		if !strings.EqualFold(mediaType, applications.OfferLetterContentType) {
			s.Problem(r.Context(), w, orgsproblem.OfferLetterInvalidError)
			return
		}
		if r.ContentLength > applications.MaxOfferLetterBytes {
			s.Problem(r.Context(), w, orgsproblem.OfferLetterTooLargeError)
			return
		}
		// The extra byte tells an exact-limit body from an oversized one
		// without an unbounded read.
		letter, err := io.ReadAll(io.LimitReader(
			r.Body, applications.MaxOfferLetterBytes+1,
		))
		if err != nil {
			s.Problem(r.Context(), w, orgsproblem.OfferLetterInvalidError)
			return
		}
		if len(letter) > applications.MaxOfferLetterBytes {
			s.Problem(r.Context(), w, orgsproblem.OfferLetterTooLargeError)
			return
		}
		if !applications.IsPDF(letter) {
			s.Problem(r.Context(), w, orgsproblem.OfferLetterInvalidError)
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		upload := letterUpload{
			identity: identity, key: key, letter: letter,
			digest: sha256.Sum256(letter),
			// A keyed, UUID-shaped identifier lets a retry find the same
			// staged object after a crash without a guessable storage key.
			objectID: letterObjectID(
				s.CredentialSubkey("offer-letter-object-id"),
				identity.OrgDID, identity.UserID, key,
			),
		}
		replay, details, err := upload.prepare(r.Context(), s)
		if details != nil {
			s.Problem(r.Context(), w, details)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "prepare offer letter", err)
			return
		}
		if !replay {
			putCtx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
			err = s.OfferLetters.PutOfferLetter(putCtx, upload.objectID, letter)
			cancel()
			if err != nil {
				// The staged row survives: a retry puts the identical bytes,
				// and an abandoned one expires into the deletion queue.
				s.InternalError(r.Context(), w, "store offer letter", err)
				return
			}
			details, err = upload.complete(r.Context(), s)
			if details != nil {
				s.Problem(r.Context(), w, details)
				return
			}
			if err != nil {
				s.InternalError(r.Context(), w, "complete offer letter", err)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusCreated, upload.result())
	}
}

type letterUpload struct {
	identity middleware.OrgIdentity
	key      common.IdempotencyKey
	letter   []byte
	digest   [32]byte
	objectID pgtype.UUID
}

func (u letterUpload) result() applications.OfferLetterUploaded {
	return applications.OfferLetterUploaded{
		LetterID: applications.OfferLetterID(dbvalue.FormatUUID(u.objectID)),
	}
}

func (u letterUpload) lookup() sqlc.GetIdempotencyParams {
	return sqlc.GetIdempotencyParams{
		Operation:      offerLetterUploadOperation,
		BindingID:      dbvalue.FormatUUID(u.identity.UserID),
		IdempotencyKey: string(u.key),
	}
}

// replayed reads this upload's live idempotency entry under its lock:
// whether it completed, or the problem a different request with the key
// gets. found is false when there is no entry.
func (u letterUpload) replayed(
	ctx context.Context, q *sqlc.Queries,
) (found, completed bool, details problem.Body, err error) {
	if err := q.LockIdempotency(ctx, offerLetterUploadOperation+":"+
		dbvalue.FormatUUID(u.identity.UserID)+":"+string(u.key)); err != nil {
		return false, false, nil, err
	}
	if err := q.DeleteExpiredIdempotency(ctx,
		sqlc.DeleteExpiredIdempotencyParams(u.lookup())); err != nil {
		return false, false, nil, err
	}
	stored, err := q.GetIdempotency(ctx, u.lookup())
	if errors.Is(err, pgx.ErrNoRows) {
		return false, false, nil, nil
	}
	if err != nil {
		return false, false, nil, err
	}
	if !bytes.Equal(stored.RequestDigest, u.digest[:]) {
		return true, false, problem.IdempotencyKeyConflictError, nil
	}
	if stored.ResponseStatus.Valid &&
		stored.ResponseStatus.Int32 != http.StatusCreated {
		return true, false, nil, fmt.Errorf(
			"unexpected offer letter replay status %d",
			stored.ResponseStatus.Int32)
	}
	return true, stored.ResponseStatus.Valid, nil, nil
}

// prepare commits the idempotency entry and the audited staged row before
// any bytes are stored. It reports a completed earlier upload as a replay.
func (u letterUpload) prepare(
	ctx context.Context, s *orgsruntime.Server,
) (bool, problem.Body, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return false, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	found, completed, details, err := u.replayed(ctx, q)
	if details != nil || err != nil {
		return false, details, err
	}
	if completed {
		return true, nil, tx.Commit(ctx)
	}
	canAct, err := q.OrgUserActsOnAnyApplications(ctx,
		sqlc.OrgUserActsOnAnyApplicationsParams{
			OrgDid: u.identity.OrgDID, OrgUserID: u.identity.UserID,
		})
	if err != nil {
		return false, nil, err
	}
	if !canAct {
		return false, orgsproblem.PermissionRequiredError, nil
	}
	if !found {
		if err := q.CreateIdempotency(ctx, sqlc.CreateIdempotencyParams{
			Operation:      offerLetterUploadOperation,
			BindingID:      dbvalue.FormatUUID(u.identity.UserID),
			IdempotencyKey: string(u.key),
			RequestDigest:  u.digest[:],
			ExpiresAt:      dbvalue.Timestamp(s.CurrentTime().Add(24 * time.Hour)),
		}); err != nil {
			return false, nil, err
		}
	}
	if err := q.LockOrgUserForOfferLetter(ctx, u.identity.UserID); err != nil {
		return false, nil, err
	}
	staged, err := q.GetOrgOfferLetterUpload(ctx,
		sqlc.GetOrgOfferLetterUploadParams{
			ObjectID: u.objectID, OrgDid: u.identity.OrgDID,
			OrgUserID: u.identity.UserID,
		})
	if err == nil {
		// A retry after a crash: put the same bytes again, unless a newer
		// upload or the clock retired the staged row meanwhile.
		if staged.State != sqlc.VetchiumOrgOfferLetterStateUploading ||
			!staged.UploadExpiresAt.Time.After(s.CurrentTime()) {
			return false, orgsproblem.OfferLetterConflictError, nil
		}
		if !bytes.Equal(staged.ContentSha256, u.digest[:]) {
			return false, nil, fmt.Errorf("staged offer letter differs from request")
		}
		return false, nil, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return false, nil, err
	}
	actor := sqlc.SupersedeOrgOfferLetterUploadsParams{
		OrgUserID: u.identity.UserID, ObjectID: u.objectID,
		TenantID: s.TenantID, IdempotencyKey: dbvalue.Text(string(u.key)),
	}
	if _, err := q.SupersedeOrgOfferLetterUploads(ctx, actor); err != nil {
		return false, nil, err
	}
	if _, err := q.PrepareOrgOfferLetterUpload(ctx,
		sqlc.PrepareOrgOfferLetterUploadParams{
			ObjectID: u.objectID, OrgDid: u.identity.OrgDID,
			OrgUserID: u.identity.UserID, ByteSize: int32(len(u.letter)),
			ContentSha256: u.digest[:], TenantID: s.TenantID,
			IdempotencyKey: dbvalue.Text(string(u.key)),
		}); err != nil {
		return false, nil, err
	}
	return false, nil, tx.Commit(ctx)
}

// complete marks the stored letter claimable and records the replayable
// result, in one transaction after the Put.
func (u letterUpload) complete(
	ctx context.Context, s *orgsruntime.Server,
) (problem.Body, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	found, completed, details, err := u.replayed(ctx, q)
	if details != nil || err != nil {
		return details, err
	}
	if !found {
		return nil, errors.New("offer letter idempotency entry vanished")
	}
	if completed {
		return nil, tx.Commit(ctx)
	}
	if err := q.LockOrgUserForOfferLetter(ctx, u.identity.UserID); err != nil {
		return nil, err
	}
	if _, err := q.MarkOrgOfferLetterUploaded(ctx,
		sqlc.MarkOrgOfferLetterUploadedParams{
			ObjectID: u.objectID, OrgDid: u.identity.OrgDID,
			OrgUserID: u.identity.UserID, TenantID: s.TenantID,
			IdempotencyKey: dbvalue.Text(string(u.key)),
		}); errors.Is(err, pgx.ErrNoRows) {
		return orgsproblem.OfferLetterConflictError, nil
	} else if err != nil {
		return nil, err
	}
	body, err := json.Marshal(u.result())
	if err != nil {
		return nil, err
	}
	ciphertext, err := s.EncryptIdempotency(body)
	if err != nil {
		return nil, err
	}
	lookup := u.lookup()
	if err := q.CompleteIdempotency(ctx, sqlc.CompleteIdempotencyParams{
		Operation: lookup.Operation, BindingID: lookup.BindingID,
		IdempotencyKey:     lookup.IdempotencyKey,
		ResponseStatus:     pgtype.Int4{Int32: http.StatusCreated, Valid: true},
		ResponseCiphertext: ciphertext,
	}); err != nil {
		return nil, err
	}
	return nil, tx.Commit(ctx)
}

func letterObjectID(
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
