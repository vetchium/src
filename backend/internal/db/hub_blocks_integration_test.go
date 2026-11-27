package db

import (
	"context"
	"encoding/hex"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

type blocksHarness struct {
	t   *testing.T
	ctx context.Context
	tx  pgx.Tx
	q   *sqlc.Queries
}

func newBlocksHarness(t *testing.T) *blocksHarness {
	t.Helper()
	databaseURL := os.Getenv("TENANT_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TENANT_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(ctx) })
	return &blocksHarness{t: t, ctx: ctx, tx: tx, q: sqlc.New(tx)}
}

// user inserts a Hub user with a valid unique handle; the label only names
// the user in the test.
func (h *blocksHarness) user(_ string) pgtype.UUID {
	h.t.Helper()
	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		h.t.Fatal(err)
	}
	if _, err := h.tx.Exec(h.ctx, `INSERT INTO vetchium.hub_users
        (hub_user_did, handle, email_address, email_digest, display_name,
         password_hash, resident_country, hub_plan_oid)
        VALUES ($1, $2, $3, sha256(convert_to($3, 'UTF8')), 'Blocks Test',
                'test-hash', 'SG', 'hub-free-tier')`,
		did, "blktest0-"+hex.EncodeToString(did.Bytes[5:])[:11],
		fmt.Sprintf("blocks-test-%s@example.com", dbvalue.FormatUUID(did)),
	); err != nil {
		h.t.Fatal(err)
	}
	return did
}

// stamp gives a row a distinct instant; one transaction shares one now().
func (h *blocksHarness) stamp(table, actorCol, otherCol string, actor, other pgtype.UUID, at time.Time) {
	h.t.Helper()
	if _, err := h.tx.Exec(h.ctx, fmt.Sprintf(
		`UPDATE vetchium.%s SET created_at = $3 WHERE %s = $1 AND %s = $2`,
		table, actorCol, otherCol), actor, other, at); err != nil {
		h.t.Fatal(err)
	}
}

func (h *blocksHarness) block(blocker, blocked pgtype.UUID, handle string) int64 {
	h.t.Helper()
	row, err := h.q.InsertHubUserBlock(h.ctx, sqlc.InsertHubUserBlockParams{
		BlockerHubUserDid: blocker, BlockedHubUserDid: blocked,
		BlockedHandle: handle, BlockedTenantID: "tenant-a", TenantID: "tenant-a",
	})
	if err != nil {
		h.t.Fatal(err)
	}
	if row.InsertedRows != row.AuditRows {
		h.t.Fatalf("audit rows = %d, want %d", row.AuditRows, row.InsertedRows)
	}
	return row.InsertedRows
}

func (h *blocksHarness) mute(muter, muted pgtype.UUID, handle string) int64 {
	h.t.Helper()
	row, err := h.q.InsertHubUserMute(h.ctx, sqlc.InsertHubUserMuteParams{
		MuterHubUserDid: muter, MutedHubUserDid: muted,
		MutedHandle: handle, MutedTenantID: "tenant-a", TenantID: "tenant-a",
	})
	if err != nil {
		h.t.Fatal(err)
	}
	if row.InsertedRows != row.AuditRows {
		h.t.Fatalf("audit rows = %d, want %d", row.AuditRows, row.InsertedRows)
	}
	return row.InsertedRows
}

func (h *blocksHarness) count(table string) int {
	h.t.Helper()
	var n int
	if err := h.tx.QueryRow(h.ctx, "SELECT count(*) FROM vetchium."+table).Scan(&n); err != nil {
		h.t.Fatal(err)
	}
	return n
}

func TestHubUserBlockInsertTwiceIsNoOp(t *testing.T) {
	h := newBlocksHarness(t)
	a, b := h.user("blk-a1"), h.user("blk-b1")
	if got := h.block(a, b, "blk-b1"); got != 1 {
		t.Fatalf("first insert = %d, want 1", got)
	}
	if got := h.block(a, b, "blk-b1"); got != 0 {
		t.Fatalf("second insert = %d, want 0", got)
	}
	if got := h.mute(a, b, "blk-b1"); got != 1 {
		t.Fatalf("first mute = %d, want 1", got)
	}
	if got := h.mute(a, b, "blk-b1"); got != 0 {
		t.Fatalf("second mute = %d, want 0", got)
	}
	exists, err := h.q.HubUserBlockExists(h.ctx, sqlc.HubUserBlockExistsParams{
		BlockerHubUserDid: a, BlockedHubUserDid: b})
	if err != nil || !exists {
		t.Fatalf("block exists = %v, %v", exists, err)
	}
	exists, err = h.q.HubUserBlockExists(h.ctx, sqlc.HubUserBlockExistsParams{
		BlockerHubUserDid: b, BlockedHubUserDid: a})
	if err != nil || exists {
		t.Fatalf("reverse block exists = %v, %v", exists, err)
	}
}

func TestHubUserBlockDelete(t *testing.T) {
	h := newBlocksHarness(t)
	a, b := h.user("blk-a2"), h.user("blk-b2")
	h.block(a, b, "blk-b2")
	row, err := h.q.DeleteHubUserBlock(h.ctx, sqlc.DeleteHubUserBlockParams{
		BlockerHubUserDid: a, BlockedHubUserDid: b, TenantID: "tenant-a"})
	if err != nil || row.DeletedRows != 1 || row.AuditRows != 1 {
		t.Fatalf("delete = %+v, %v", row, err)
	}
	row, err = h.q.DeleteHubUserBlock(h.ctx, sqlc.DeleteHubUserBlockParams{
		BlockerHubUserDid: a, BlockedHubUserDid: b, TenantID: "tenant-a"})
	if err != nil || row.DeletedRows != 0 || row.AuditRows != 0 {
		t.Fatalf("repeat delete = %+v, %v", row, err)
	}
	mrow, err := h.q.DeleteHubUserMute(h.ctx, sqlc.DeleteHubUserMuteParams{
		MuterHubUserDid: a, MutedHubUserDid: b, TenantID: "tenant-a"})
	if err != nil || mrow.DeletedRows != 0 {
		t.Fatalf("mute delete = %+v, %v", mrow, err)
	}
}

func TestHubUserBlockSelfViolatesCheck(t *testing.T) {
	h := newBlocksHarness(t)
	a := h.user("blk-a3")
	sp, err := h.tx.Begin(h.ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = sqlc.New(sp).InsertHubUserBlock(h.ctx, sqlc.InsertHubUserBlockParams{
		BlockerHubUserDid: a, BlockedHubUserDid: a, BlockedHandle: "blk-a3",
		BlockedTenantID: "tenant-a", TenantID: "tenant-a"})
	if err == nil {
		t.Fatal("self block succeeded")
	}
	_ = sp.Rollback(h.ctx)
	sp, err = h.tx.Begin(h.ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = sqlc.New(sp).InsertHubUserMute(h.ctx, sqlc.InsertHubUserMuteParams{
		MuterHubUserDid: a, MutedHubUserDid: a, MutedHandle: "blk-a3",
		MutedTenantID: "tenant-a", TenantID: "tenant-a"})
	if err == nil {
		t.Fatal("self mute succeeded")
	}
	_ = sp.Rollback(h.ctx)
}

func TestHubUserBlockListKeyset(t *testing.T) {
	h := newBlocksHarness(t)
	a := h.user("blk-a4")
	base := time.Now().UTC().Truncate(time.Second)
	for i, handle := range []string{"blk-x4", "blk-y4", "blk-z4"} {
		o := h.user(handle)
		h.block(a, o, handle)
		h.stamp("hub_user_blocks", "blocker_hub_user_did", "blocked_hub_user_did",
			a, o, base.Add(time.Duration(i)*time.Minute))
	}
	// Limit 2 plus the extra row that tells the caller more remain.
	first, err := h.q.ListHubUserBlocks(h.ctx, sqlc.ListHubUserBlocksParams{
		BlockerHubUserDid: a, PageLimit: 3})
	if err != nil || len(first) != 3 {
		t.Fatalf("first = %d, %v", len(first), err)
	}
	if first[0].BlockedHandle != "blk-z4" || first[2].BlockedHandle != "blk-x4" {
		t.Fatalf("order = %s, %s, %s", first[0].BlockedHandle,
			first[1].BlockedHandle, first[2].BlockedHandle)
	}
	last := first[1]
	rest, err := h.q.ListHubUserBlocks(h.ctx, sqlc.ListHubUserBlocksParams{
		BlockerHubUserDid: a, PageLimit: 3,
		BeforeCreatedAt:         last.CreatedAt,
		BeforeBlockedHubUserDid: last.BlockedHubUserDid,
	})
	if err != nil || len(rest) != 1 || rest[0].BlockedHandle != "blk-x4" {
		t.Fatalf("rest = %+v, %v", rest, err)
	}
}

func TestHubUserMuteListKeyset(t *testing.T) {
	h := newBlocksHarness(t)
	a := h.user("blk-a5")
	base := time.Now().UTC().Truncate(time.Second)
	for i, handle := range []string{"blk-x5", "blk-y5", "blk-z5"} {
		o := h.user(handle)
		h.mute(a, o, handle)
		h.stamp("hub_user_mutes", "muter_hub_user_did", "muted_hub_user_did",
			a, o, base.Add(time.Duration(i)*time.Minute))
	}
	page, err := h.q.ListHubUserMutes(h.ctx, sqlc.ListHubUserMutesParams{
		MuterHubUserDid: a, PageLimit: 3})
	if err != nil || len(page) != 3 || page[0].MutedHandle != "blk-z5" {
		t.Fatalf("page = %+v, %v", page, err)
	}
	rest, err := h.q.ListHubUserMutes(h.ctx, sqlc.ListHubUserMutesParams{
		MuterHubUserDid: a, PageLimit: 3,
		BeforeCreatedAt:       page[1].CreatedAt,
		BeforeMutedHubUserDid: page[1].MutedHubUserDid,
	})
	if err != nil || len(rest) != 1 || rest[0].MutedHandle != "blk-x5" {
		t.Fatalf("rest = %+v, %v", rest, err)
	}
}

func TestHubUserBlockedAnyAndMutedAny(t *testing.T) {
	h := newBlocksHarness(t)
	a, b, c, d := h.user("blk-a6"), h.user("blk-b6"), h.user("blk-c6"), h.user("blk-d6")
	h.block(a, b, "blk-b6")
	h.mute(a, c, "blk-c6")
	h.block(d, c, "blk-c6")
	blocked, err := h.q.HubUserBlockedAny(h.ctx, sqlc.HubUserBlockedAnyParams{
		BlockerHubUserDid: a, CandidateDids: []pgtype.UUID{b, c, d}})
	if err != nil || len(blocked) != 1 || blocked[0] != b {
		t.Fatalf("blocked = %v, %v", blocked, err)
	}
	muted, err := h.q.HubUserMutedAny(h.ctx, sqlc.HubUserMutedAnyParams{
		MuterHubUserDid: a, CandidateDids: []pgtype.UUID{b, c, d}})
	if err != nil || len(muted) != 1 || muted[0] != c {
		t.Fatalf("muted = %v, %v", muted, err)
	}
}

func TestHubUserDeleteCascadesBlocksAndMutes(t *testing.T) {
	h := newBlocksHarness(t)
	a, b := h.user("blk-a7"), h.user("blk-b7")
	h.block(a, b, "blk-b7")
	h.mute(a, b, "blk-b7")
	// The blocked user is a routing hint, not a row: deleting it keeps A's.
	if _, err := h.tx.Exec(h.ctx, `DELETE FROM vetchium.hub_users WHERE hub_user_did = $1`, b); err != nil {
		t.Fatal(err)
	}
	if h.count("hub_user_blocks") < 1 || h.count("hub_user_mutes") < 1 {
		t.Fatal("deleting the blocked user removed the blocker's rows")
	}
	if _, err := h.tx.Exec(h.ctx, `DELETE FROM vetchium.hub_users WHERE hub_user_did = $1`, a); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := h.tx.QueryRow(h.ctx, `SELECT
        (SELECT count(*) FROM vetchium.hub_user_blocks WHERE blocker_hub_user_did = $1) +
        (SELECT count(*) FROM vetchium.hub_user_mutes WHERE muter_hub_user_did = $1)`, a).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("rows left after deleting the Hub user: %d", n)
	}
}
