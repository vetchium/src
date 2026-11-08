package messages

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vetchium/src/typespec/common"
	hubmessages "github.com/vetchium/src/typespec/hub/messages"

	"backend/internal/dbvalue"
)

func TestCountChatRequestSendIntegration(t *testing.T) {
	databaseURL := os.Getenv("TENANT_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TENANT_DATABASE_URL is not set")
	}
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close()
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	config.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		_, err := conn.Exec(ctx, "SET ROLE vetchium_app")
		return err
	}
	app, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()

	hubDID, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	text := dbvalue.FormatUUID(hubDID)
	defer func() {
		for _, sql := range []string{
			`DELETE FROM vetchium.audit_events WHERE subject_hub_user_did = $1`,
			`DELETE FROM vetchium.hub_users WHERE hub_user_did = $1`,
		} {
			if _, err := owner.Exec(ctx, sql, hubDID); err != nil {
				t.Errorf("clean up: %v", err)
			}
		}
	}()
	if _, err := owner.Exec(ctx, `INSERT INTO vetchium.hub_users (hub_user_did,
            handle, email_address, email_digest, display_name, password_hash,
            resident_country, hub_plan_oid)
        VALUES ($1, $2, $3, sha256(convert_to($3, 'UTF8')), 'Ada Lovelace',
            'test-hash', 'DE', 'hub-free-tier')`,
		hubDID, "chatcnt0-"+text[len(text)-11:],
		"ada-"+text[len(text)-12:]+"@count.example"); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	count := func(key common.IdempotencyKey) bool {
		t.Helper()
		allowed, err := countChatRequestSend(ctx, app, "usa1", hubDID, key, now)
		if err != nil {
			t.Fatal(err)
		}
		return allowed
	}
	counted := func() int {
		t.Helper()
		var value int
		if err := owner.QueryRow(ctx, `SELECT COALESCE(sum(created), 0)::int
            FROM vetchium.hub_chat_request_creations
            WHERE hub_user_did = $1`, hubDID).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	key := func(index int) common.IdempotencyKey {
		return common.IdempotencyKey(fmt.Sprintf("count-%s-%02d", text, index))
	}

	// A retry under the same key, as after a failure before the command was
	// stored, counts once.
	first, retry := count(key(0)), count(key(0))
	if !first || !retry || counted() != 1 {
		t.Fatalf("a repeated key: counted %d", counted())
	}
	for index := 1; index < int(hubmessages.MaxChatRequestsPerDay); index++ {
		if !count(key(index)) {
			t.Fatalf("send %d refused", index)
		}
	}
	if counted() != int(hubmessages.MaxChatRequestsPerDay) {
		t.Fatalf("counted %d sends", counted())
	}
	if count(key(99)) {
		t.Fatal("a send past the day's limit was allowed")
	}
	// A counted send stays allowed once the day is full.
	if !count(key(3)) || counted() != int(hubmessages.MaxChatRequestsPerDay) {
		t.Fatalf("a counted key past the limit: counted %d", counted())
	}
}
