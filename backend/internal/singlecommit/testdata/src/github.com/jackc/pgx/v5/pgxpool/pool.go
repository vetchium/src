package pgxpool

import (
	"context"

	"github.com/jackc/pgx/v5"
)

type Pool struct{}

func (*Pool) Begin(context.Context) (pgx.Tx, error) { return nil, nil }

func (*Pool) Exec(context.Context, string, ...any) error { return nil }
