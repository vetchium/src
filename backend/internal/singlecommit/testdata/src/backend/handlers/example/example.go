package example

import (
	"context"
	"errors"
	"net/http"

	"backend/internal/db/sqlc"
	"backend/internal/worker"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	Pool    *pgxpool.Pool
	Queries *sqlc.Queries
	Worker  *worker.Service
	Writer  userWriter
}

type userWriter interface {
	SaveUser(context.Context) error
}

func run(ctx context.Context, s *Server, work func(*sqlc.Queries) error) error { // want run:"commits 1"
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	if err := work(sqlc.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func OneStatement(ctx context.Context, s *Server) error { // want OneStatement:"commits 1"
	return s.Queries.SaveUser(ctx)
}

func ReadsAreFree(ctx context.Context, s *Server) error { // want ReadsAreFree:"commits 1"
	_ = s.Queries.ReadUser(ctx)
	_ = s.Queries.ReadUser(ctx)
	return s.Queries.SaveUser(ctx)
}

func TwoStatements(ctx context.Context, s *Server) error { // want `TwoStatements can commit more than one transaction` TwoStatements:"commits 2"
	_ = s.Queries.SaveUser(ctx)
	return s.Queries.UpsertUser(ctx)
}

func TransactionThenStatement(ctx context.Context, s *Server) error { // want `TransactionThenStatement can commit more than one transaction` TransactionThenStatement:"commits 2"
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	q := sqlc.New(tx)
	_ = q.SaveUser(ctx)
	_ = q.UpsertUser(ctx)
	_ = tx.Commit(ctx)
	return s.Queries.SaveUser(ctx)
}

func OneTransaction(ctx context.Context, s *Server) error { // want OneTransaction:"commits 1"
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	q := sqlc.New(tx)
	savepoint, _ := tx.Begin(ctx)
	_ = savepoint.Commit(ctx)
	_ = q.SaveUser(ctx)
	_ = q.UpsertUser(ctx)
	return tx.Commit(ctx)
}

func Callback(ctx context.Context, s *Server) error { // want Callback:"commits 1"
	return run(ctx, s, func(q *sqlc.Queries) error {
		_ = q.SaveUser(ctx)
		return q.UpsertUser(ctx)
	})
}

func CallbackPlusStatement(ctx context.Context, s *Server) error { // want `CallbackPlusStatement can commit more than one transaction` CallbackPlusStatement:"commits 2"
	_ = run(ctx, s, func(q *sqlc.Queries) error { return q.SaveUser(ctx) })
	return s.Queries.SaveUser(ctx)
}

func Alternatives(ctx context.Context, s *Server, flag bool) error { // want Alternatives:"commits 1"
	if flag {
		return s.Queries.SaveUser(ctx)
	}
	switch {
	case flag:
		_ = s.Queries.SaveUser(ctx)
	default:
		_ = s.Queries.UpsertUser(ctx)
	}
	return nil
}

func FailureRecorded(ctx context.Context, s *Server) error { // want `FailureRecorded can commit more than one transaction` FailureRecorded:"commits 2"
	if err := s.Queries.SaveUser(ctx); err != nil {
		return errors.Join(err, s.Queries.UpsertUser(ctx))
	}
	return nil
}

func Loop(ctx context.Context, s *Server) { // want `Loop can commit more than one transaction` Loop:"commits 2"
	for range 2 {
		_ = s.Queries.SaveUser(ctx)
	}
}

func HelperWithPool(ctx context.Context, s *Server) error { // want `HelperWithPool can commit more than one transaction` HelperWithPool:"commits 2"
	_ = worker.Save(ctx, s.Queries)
	return s.Worker.SaveOnce(ctx)
}

func HelperWithTransaction(ctx context.Context, s *Server) error { // want HelperWithTransaction:"commits 1"
	return run(ctx, s, func(q *sqlc.Queries) error {
		_ = worker.Save(ctx, q)
		return worker.Save(ctx, q)
	})
}

func ParameterWrites(ctx context.Context, q *sqlc.Queries) error { // want ParameterWrites:"commits 0 param1=2"
	_ = q.SaveUser(ctx)
	return q.UpsertUser(ctx)
}

func ParameterFromPool(ctx context.Context, s *Server) error { // want `ParameterFromPool can commit more than one transaction` ParameterFromPool:"commits 2"
	return ParameterWrites(ctx, s.Queries)
}

func Interface(ctx context.Context, s *Server) error { // want `Interface can commit more than one transaction` Interface:"commits 2"
	_ = s.Writer.SaveUser(ctx)
	return s.Queries.SaveUser(ctx)
}

func Excused(ctx context.Context, s *Server) error { // want Excused:"commits 1"
	s.Worker.Saga(ctx)
	return nil
}

func ExcusedPlusStatement(ctx context.Context, s *Server) error { // want `ExcusedPlusStatement can commit more than one transaction` ExcusedPlusStatement:"commits 2"
	s.Worker.Saga(ctx)
	return s.Queries.SaveUser(ctx)
}

func Goroutine(ctx context.Context, s *Server) error { // want Goroutine:"commits 1"
	go s.Worker.Sweep(context.Background())
	return s.Queries.SaveUser(ctx)
}

func Handler(s *Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { // want `function literal in Handler can commit more than one transaction`
		_ = s.Queries.SaveUser(r.Context())
		_ = s.Queries.SaveUser(r.Context())
	}
}

//vetchium:multiple-commits uploads the object between its two commits
func ExcusedHandler(s *Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_ = s.Queries.SaveUser(r.Context())
		_ = s.Queries.SaveUser(r.Context())
	}
}

//vetchium:multiple-commits
func NoReason(ctx context.Context, s *Server) error { // want `NoReason needs a reason after //vetchium:multiple-commits`
	return nil
}
