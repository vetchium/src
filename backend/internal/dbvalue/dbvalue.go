// Package dbvalue converts between ordinary Go values and the pgtype values
// the generated sqlc interface expects. It is shared by every portal and owns
// no portal-specific behavior.
package dbvalue

import (
	"crypto/rand"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// NewUUID returns a random version 4 identifier.
func NewUUID() (pgtype.UUID, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return pgtype.UUID{}, fmt.Errorf("generate UUID: %w", err)
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return pgtype.UUID{Bytes: value, Valid: true}, nil
}

// NewUUIDv7 returns a time-ordered identifier, which keeps index inserts local
// for rows that are written in creation order.
func NewUUIDv7(now time.Time) (pgtype.UUID, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return pgtype.UUID{}, fmt.Errorf("generate UUIDv7 randomness: %w", err)
	}
	milliseconds := now.UTC().UnixMilli()
	if milliseconds < 0 || milliseconds > (1<<48)-1 {
		return pgtype.UUID{}, fmt.Errorf("UUIDv7 timestamp is out of range")
	}
	value[0] = byte(milliseconds >> 40)
	value[1] = byte(milliseconds >> 32)
	value[2] = byte(milliseconds >> 24)
	value[3] = byte(milliseconds >> 16)
	value[4] = byte(milliseconds >> 8)
	value[5] = byte(milliseconds)
	value[6] = (value[6] & 0x0f) | 0x70
	value[8] = (value[8] & 0x3f) | 0x80
	return pgtype.UUID{Bytes: value, Valid: true}, nil
}

func FormatUUID(value pgtype.UUID) string {
	if !value.Valid {
		return ""
	}
	return value.String()
}

func ParseUUID(value string) (pgtype.UUID, error) {
	var result pgtype.UUID
	err := result.Scan(value)
	if err != nil || !result.Valid {
		return pgtype.UUID{}, fmt.Errorf("parse UUID %q", value)
	}
	return result, nil
}

func Timestamp(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value.UTC(), Valid: true}
}

func Int64(value int64) pgtype.Int8 {
	return pgtype.Int8{Int64: value, Valid: true}
}

func Text(value string) pgtype.Text {
	return pgtype.Text{String: value, Valid: true}
}

// NullText maps a nil pointer to SQL NULL, which is how optional filters and
// nullable columns are passed to generated queries.
func NullText(value *string) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *value, Valid: true}
}

func NullBool(value *bool) pgtype.Bool {
	if value == nil {
		return pgtype.Bool{}
	}
	return pgtype.Bool{Bool: *value, Valid: true}
}
