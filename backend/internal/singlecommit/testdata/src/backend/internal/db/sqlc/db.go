package sqlc

import "context"

type DBTX interface {
	Exec(ctx context.Context, sql string, args ...any) error
}

type Queries struct{ db DBTX }

func New(db DBTX) *Queries { return &Queries{db: db} }

const readUser = `-- name: ReadUser :one
SELECT name FROM users WHERE id = $1 FOR UPDATE`

func (q *Queries) ReadUser(ctx context.Context) error {
	return q.db.Exec(ctx, readUser)
}

const saveUser = `-- name: SaveUser :exec
WITH updated AS (UPDATE users SET name = $1 RETURNING id)
INSERT INTO audit_events (action) SELECT 'user.saved' FROM updated`

func (q *Queries) SaveUser(ctx context.Context) error {
	return q.db.Exec(ctx, saveUser)
}

const upsertUser = `-- name: UpsertUser :exec
INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO UPDATE SET id = $1`

func (q *Queries) UpsertUser(ctx context.Context) error {
	return q.db.Exec(ctx, upsertUser)
}
