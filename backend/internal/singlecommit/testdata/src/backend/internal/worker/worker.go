package worker

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"backend/internal/db/sqlc"
)

type Service struct {
	Pool    *pgxpool.Pool
	Queries *sqlc.Queries
}

// Background work is summarized but never reported.
func (s *Service) Sweep(ctx context.Context) { // want Sweep:"commits 2"
	for range 3 {
		_ = s.Queries.SaveUser(ctx)
	}
}

func (s *Service) SaveOnce(ctx context.Context) error { // want SaveOnce:"commits 1"
	return s.Queries.SaveUser(ctx)
}

func Save(ctx context.Context, q *sqlc.Queries) error { // want Save:"commits 0 param1=1"
	return q.SaveUser(ctx)
}

//vetchium:multiple-commits commits, calls a remote service, then commits
func (s *Service) Saga(ctx context.Context) { // want Saga:"commits 1"
	_ = s.Queries.SaveUser(ctx)
	_ = s.Queries.UpsertUser(ctx)
}

//vetchium:multiple-commits
func Unexplained(ctx context.Context, s *Service) { // want `Unexplained needs a reason after //vetchium:multiple-commits`
}
