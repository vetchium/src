package workers

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/db/sqlc"
)

type offerLetterQueriesStub struct {
	claims    []sqlc.ClaimOrgOfferLetterDeletionRow
	queuedFor []string
	completed []pgtype.UUID
	retried   []sqlc.RetryOrgOfferLetterDeletionParams
}

func (s *offerLetterQueriesStub) QueueExpiredOrgOfferLetters(
	_ context.Context, tenantID string,
) (int32, error) {
	s.queuedFor = append(s.queuedFor, tenantID)
	return 1, nil
}

func (s *offerLetterQueriesStub) ClaimOrgOfferLetterDeletion(
	_ context.Context, _ sqlc.ClaimOrgOfferLetterDeletionParams,
) (sqlc.ClaimOrgOfferLetterDeletionRow, error) {
	if len(s.claims) == 0 {
		return sqlc.ClaimOrgOfferLetterDeletionRow{}, pgx.ErrNoRows
	}
	row := s.claims[0]
	s.claims = s.claims[1:]
	return row, nil
}

func (s *offerLetterQueriesStub) RetryOrgOfferLetterDeletion(
	_ context.Context, arg sqlc.RetryOrgOfferLetterDeletionParams,
) (int64, error) {
	s.retried = append(s.retried, arg)
	return 1, nil
}

func (s *offerLetterQueriesStub) CompleteOrgOfferLetterDeletion(
	_ context.Context, arg sqlc.CompleteOrgOfferLetterDeletionParams,
) (pgtype.UUID, error) {
	s.completed = append(s.completed, arg.ObjectID)
	return arg.ObjectID, nil
}

type offerLetterStoreStub struct {
	deleted []pgtype.UUID
	err     error
}

func (s *offerLetterStoreStub) DeleteOfferLetter(
	_ context.Context, id pgtype.UUID,
) error {
	s.deleted = append(s.deleted, id)
	return s.err
}

// Letters nobody claimed (superseded, or unclaimed past their window) are
// queued first, then each claimed one is deleted from the object store and
// only then removed from the database.
func TestDeleteOfferLettersRemovesUnclaimedStagedLetters(t *testing.T) {
	first := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	second := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	queries := &offerLetterQueriesStub{claims: []sqlc.ClaimOrgOfferLetterDeletionRow{
		{ObjectID: first}, {ObjectID: second},
	}}
	store := &offerLetterStoreStub{}
	worker := &Worker{
		offerLetterQueries: queries, offerLetterStore: store, tenantID: "sgp",
		log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	if err := worker.deleteOfferLetters(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(queries.queuedFor) != 1 || queries.queuedFor[0] != "sgp" {
		t.Fatalf("expired letters queued for %v", queries.queuedFor)
	}
	if len(store.deleted) != 2 || store.deleted[0] != first ||
		store.deleted[1] != second || len(queries.completed) != 2 ||
		len(queries.retried) != 0 {
		t.Fatalf("deleted=%v completed=%v retried=%d", store.deleted,
			queries.completed, len(queries.retried))
	}
}

func TestDeleteOfferLettersRetriesWithoutLeakingTheStoreError(t *testing.T) {
	id := pgtype.UUID{Bytes: [16]byte{3}, Valid: true}
	queries := &offerLetterQueriesStub{claims: []sqlc.ClaimOrgOfferLetterDeletionRow{
		{ObjectID: id},
	}}
	store := &offerLetterStoreStub{err: errors.New("s3 down at 10.0.0.7")}
	worker := &Worker{
		offerLetterQueries: queries, offerLetterStore: store, tenantID: "sgp",
		log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	if err := worker.deleteOfferLetters(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(queries.completed) != 0 || len(queries.retried) != 1 ||
		queries.retried[0].LastError != "object-store deletion failed" ||
		queries.retried[0].ObjectID != id {
		t.Fatalf("completed=%v retried=%+v", queries.completed, queries.retried)
	}
}
