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

type pictureQueriesStub struct {
	claims    []sqlc.ClaimHubProfilePictureDeletionRow
	queued    int
	completed int
	retried   int
	retryErr  string
}

func (s *pictureQueriesStub) QueueExpiredHubProfilePictureUploads(_ context.Context, tenantID string) (int32, error) {
	if tenantID != "sgp" {
		return 0, errors.New("wrong tenant")
	}
	s.queued++
	return 1, nil
}

func (s *pictureQueriesStub) ClaimHubProfilePictureDeletion(
	_ context.Context, _ pgtype.UUID,
) (sqlc.ClaimHubProfilePictureDeletionRow, error) {
	if len(s.claims) == 0 {
		return sqlc.ClaimHubProfilePictureDeletionRow{}, pgx.ErrNoRows
	}
	row := s.claims[0]
	s.claims = s.claims[1:]
	return row, nil
}

func (s *pictureQueriesStub) RetryHubProfilePictureDeletion(
	_ context.Context, arg sqlc.RetryHubProfilePictureDeletionParams,
) (int64, error) {
	s.retried++
	s.retryErr = arg.LastError
	return 1, nil
}

func (s *pictureQueriesStub) CompleteHubProfilePictureDeletion(
	_ context.Context, arg sqlc.CompleteHubProfilePictureDeletionParams,
) (pgtype.UUID, error) {
	s.completed++
	if arg.TenantID != "sgp" {
		return pgtype.UUID{}, errors.New("wrong tenant")
	}
	return arg.ObjectID, nil
}

type pictureStoreStub struct {
	deleted []pgtype.UUID
	err     error
}

func (s *pictureStoreStub) Delete(_ context.Context, id pgtype.UUID) error {
	s.deleted = append(s.deleted, id)
	return s.err
}

func TestPictureDeletionCompletesAndRetriesSafely(t *testing.T) {
	id := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	for _, tc := range []struct {
		name      string
		storeErr  error
		completed int
		retried   int
	}{
		{"deleted", nil, 1, 0},
		{"store unavailable", errors.New("temporary S3 failure"), 0, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			queries := &pictureQueriesStub{
				claims: []sqlc.ClaimHubProfilePictureDeletionRow{{ObjectID: id}},
			}
			store := &pictureStoreStub{err: tc.storeErr}
			worker := &Worker{
				pictureQueries: queries, pictureStore: store, tenantID: "sgp",
				log: slog.New(slog.NewTextHandler(io.Discard, nil)),
			}
			if err := worker.deleteHubProfilePictures(context.Background()); err != nil {
				t.Fatal(err)
			}
			if queries.queued != 1 || queries.completed != tc.completed ||
				queries.retried != tc.retried || len(store.deleted) != 1 ||
				store.deleted[0] != id {
				t.Fatalf("queued=%d completed=%d retried=%d deleted=%v",
					queries.queued, queries.completed, queries.retried, store.deleted)
			}
			if tc.retried == 1 && queries.retryErr != "object-store deletion failed" {
				t.Fatalf("unsafe retry error = %q", queries.retryErr)
			}
		})
	}
}
