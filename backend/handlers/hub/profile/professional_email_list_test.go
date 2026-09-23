package profile

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	hubruntime "backend/internal/hub"
)

func TestProfessionalEmailCursorIsBoundAndOrdered(t *testing.T) {
	s := &hubruntime.Server{CredentialKey: [32]byte{1, 2, 3}}
	id, err := dbvalue.ParseUUID("01987aef-1234-7abc-8abc-123456789abc")
	if err != nil {
		t.Fatal(err)
	}
	verifiedAt := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	createdAt := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	row := sqlc.ListHubProfessionalEmailsRow{
		ProfessionalEmailID: id,
		LastVerifiedAt:      dbvalue.Timestamp(verifiedAt),
		CreatedAt:           dbvalue.Timestamp(createdAt),
	}
	key, err := encodeProfessionalEmailCursor(s, "viewer", row)
	if err != nil {
		t.Fatal(err)
	}
	cursor, ok := decodeProfessionalEmailCursor(s, string(key), "viewer")
	if !ok || cursor.LastVerifiedAt == nil ||
		!cursor.LastVerifiedAt.Equal(verifiedAt) ||
		!cursor.CreatedAt.Equal(createdAt) {
		t.Fatalf("cursor = %+v, valid = %t", cursor, ok)
	}
	if _, ok := decodeProfessionalEmailCursor(s, string(key), "other-viewer"); ok {
		t.Fatal("cross-user cursor was accepted")
	}
	if _, ok := decodeProfessionalEmailCursor(s, string(key)+"x", "viewer"); ok {
		t.Fatal("tampered cursor was accepted")
	}
	if professionalEmailAfterCursor(row, cursor) {
		t.Fatal("cursor row repeated")
	}
	older := row
	older.LastVerifiedAt = dbvalue.Timestamp(verifiedAt.Add(-time.Hour))
	if !professionalEmailAfterCursor(older, cursor) {
		t.Fatal("older verified row was skipped")
	}
	pending := row
	pending.LastVerifiedAt = pgtype.Timestamptz{}
	if !professionalEmailAfterCursor(pending, cursor) {
		t.Fatal("pending row did not follow verified rows")
	}
}
