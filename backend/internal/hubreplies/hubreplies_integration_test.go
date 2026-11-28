package hubreplies

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/hub"
	hubposts "github.com/vetchium/src/typespec/hub/posts"

	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
	"backend/internal/federation/events"
	"backend/internal/postid"
)

type fixture struct {
	t        *testing.T
	ctx      context.Context
	owner    *pgxpool.Pool
	app      *pgxpool.Pool
	executor *commands.Executor
	sender   *commands.Sender
	receiver *events.Receiver
	users    []pgtype.UUID
	postIDs  []string
	keys     int
}

// refusingRelay fails the test: every authority here is local.
type refusingRelay struct{ t *testing.T }

func (r refusingRelay) Execute(
	context.Context, federationspec.ExecuteCommandRequest,
) (commands.Response, error) {
	r.t.Error("a local authority must not use the relay")
	return commands.Response{}, errors.New("relay used")
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	databaseURL := os.Getenv("TENANT_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TENANT_DATABASE_URL is not set")
	}
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Close)
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
	t.Cleanup(app.Close)
	f := &fixture{t: t, ctx: ctx, owner: owner, app: app}
	t.Cleanup(f.cleanUp)
	registry := commands.NewRegistry()
	Register(registry)
	f.executor = commands.NewExecutor(commands.ExecutorConfig{
		Pool: app, TenantID: "sgp", Registry: registry,
	})
	f.sender = commands.NewSender(commands.SenderConfig{
		Pool: app, TenantID: "sgp", Source: "hub-api", Executor: f.executor,
		Relay: refusingRelay{t},
		ResultKeys: map[commands.OwnerType][32]byte{
			commands.OwnerHubUser: sha256.Sum256([]byte("hub replies test")),
		},
	})
	eventRegistry := events.NewRegistry()
	RegisterEvents(eventRegistry)
	f.receiver = events.NewReceiver(events.ReceiverConfig{
		Pool: app, TenantID: "sgp", Source: "mesh-api", Registry: eventRegistry,
	})
	return f
}

func (f *fixture) cleanUp() {
	ctx := context.Background()
	for _, did := range f.users {
		for _, sql := range []string{
			`DELETE FROM vetchium.audit_events WHERE subject_hub_user_did = $1
                OR actor_id = $1::text`,
			`DELETE FROM vetchium.federation_operations
             WHERE owner_principal_id = $1::text`,
			`DELETE FROM vetchium.federation_outbox
             WHERE destination_principal_did = $1`,
			`DELETE FROM vetchium.federation_inbox
             WHERE destination_principal_did = $1`,
			`DELETE FROM vetchium.hub_users WHERE hub_user_did = $1`,
		} {
			var arg any = did
			if strings.Contains(sql, "::text") {
				arg = dbvalue.FormatUUID(did)
			}
			_, _ = f.owner.Exec(ctx, sql, arg)
		}
	}
	for _, id := range f.postIDs {
		_, _ = f.owner.Exec(ctx, `DELETE FROM vetchium.federation_command_ledger
            WHERE aggregate_id = $1`, id)
		_, _ = f.owner.Exec(ctx, `DELETE FROM vetchium.federation_event_watermarks
            WHERE aggregate_id = $1`, id)
	}
}

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.owner.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) scalar(sql string, args ...any) string {
	f.t.Helper()
	var value string
	if err := f.owner.QueryRow(f.ctx, sql, args...).Scan(&value); err != nil {
		f.t.Fatal(err)
	}
	return value
}

func (f *fixture) newUser() pgtype.UUID {
	f.t.Helper()
	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		f.t.Fatal(err)
	}
	raw := hex.EncodeToString(did.Bytes[10:])
	f.exec(`INSERT INTO vetchium.hub_users
        (hub_user_did, handle, email_address, email_digest, display_name,
         password_hash, resident_country, hub_plan_oid)
        VALUES ($1, $2, $3, sha256(convert_to($3, 'UTF8')), 'Replier',
                'test-hash', 'SG', 'hub-free-tier')`,
		did, raw[:8]+"-"+raw[:11], "replies-"+dbvalue.FormatUUID(did)+"@example.com")
	f.users = append(f.users, did)
	return did
}

func (f *fixture) newID() string {
	f.t.Helper()
	id, err := postid.New()
	if err != nil {
		f.t.Fatal(err)
	}
	return id
}

// newPost inserts a live post; set adds a SQL assignment list applied after.
func (f *fixture) newPost(owner pgtype.UUID, set string) string {
	f.t.Helper()
	id := f.newID()
	f.exec(`INSERT INTO vetchium.hub_posts (post_id, author_hub_user_did, kind, body)
        VALUES ($1, $2, 'post', 'a post')`, id, owner)
	if set != "" {
		f.exec(`UPDATE vetchium.hub_posts SET `+set+` WHERE post_id = $1`, id)
	}
	f.postIDs = append(f.postIDs, id)
	return id
}

func handleOf(did pgtype.UUID) hub.HubHandle {
	raw := hex.EncodeToString(did.Bytes[10:])
	return hub.HubHandle(raw[:8] + "-" + raw[:11])
}

func didOf(did pgtype.UUID) hub.HubUserDID { return hub.HubUserDID(dbvalue.FormatUUID(did)) }

func (f *fixture) payload(
	post string, reply string, parent string, replier pgtype.UUID,
) federationspec.HubPostReplyRegisterPayload {
	payload := federationspec.HubPostReplyRegisterPayload{
		PostID: hubposts.PostID(post), ReplyID: hubposts.PostID(reply),
		ReplierHubUserDID: didOf(replier), ReplierHandle: handleOf(replier),
		Body: "a reply", CreatedAt: time.Now().UTC(),
	}
	if parent != "" {
		id := hubposts.PostID(parent)
		payload.ParentReplyID = &id
	}
	return payload
}

func (f *fixture) register(
	owner pgtype.UUID, payload federationspec.HubPostReplyRegisterPayload,
) commands.Response {
	f.t.Helper()
	return f.registerAs(owner, dbvalue.FormatUUID(mustUUID(f.t)), payload)
}

func mustUUID(t *testing.T) pgtype.UUID {
	t.Helper()
	id, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// registerAs executes the command with a fixed command id, so a test can
// replay it.
func (f *fixture) registerAs(
	owner pgtype.UUID, commandID string,
	payload federationspec.HubPostReplyRegisterPayload,
) commands.Response {
	f.t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		f.t.Fatal(err)
	}
	id, err := dbvalue.ParseUUID(commandID)
	if err != nil {
		f.t.Fatal(err)
	}
	response, err := f.executor.Execute(f.ctx, commands.Command{
		CommandID: id, CorrelationID: id, SourceTenantID: "sgp",
		Kind: federationspec.HubPostReplyRegisterKind,
		Authority: commands.Principal{
			Type: directoryspec.PrincipalHubUser, DID: owner,
		},
		AggregateID: string(payload.PostID), Payload: body,
	})
	if err != nil {
		f.t.Fatal(err)
	}
	return response
}

func problemOf(t *testing.T, response commands.Response) string {
	t.Helper()
	var body struct {
		Type   string   `json:"type"`
		Fields []string `json:"fields"`
	}
	if err := json.Unmarshal(response.Body, &body); err != nil {
		t.Fatal(err)
	}
	return strings.TrimPrefix(body.Type, "vetchium-problem-details/")
}

func (f *fixture) counts(post string) string {
	return f.scalar(`SELECT reply_count::text FROM vetchium.hub_posts
        WHERE post_id = $1`, post)
}

func (f *fixture) childCounts(post, reply string) string {
	return f.scalar(`SELECT child_count || '/' || child_row_count
        FROM vetchium.hub_post_replies WHERE post_id = $1 AND reply_id = $2`,
		post, reply)
}

func (f *fixture) copyState(post, reply string) string {
	return f.scalar(`SELECT state::text || ':' || COALESCE(body, '-') || ':' || revision
        FROM vetchium.hub_post_replies WHERE post_id = $1 AND reply_id = $2`,
		post, reply)
}

func TestRegisterRefusalsFollowTheDocumentedOrderIntegration(t *testing.T) {
	f := newFixture(t)
	owner, replier := f.newUser(), f.newUser()
	register := func(post string, parent string) commands.Response {
		return f.register(owner, f.payload(post, f.newID(), parent, replier))
	}

	if got := problemOf(t, register(f.newID(), "")); got != "hub-post-not-found" {
		t.Fatalf("unknown post: %s", got)
	}
	removed := f.newPost(owner, `state = 'removed', body = NULL, removed_at = now(),
        locked_at = now()`)
	if got := problemOf(t, register(removed, "")); got != "hub-post-not-found" {
		t.Fatalf("removed and locked post: %s", got)
	}
	elsewhere := f.newPost(f.newUser(), "")
	if got := problemOf(t, register(elsewhere, "")); got != "hub-post-not-found" {
		t.Fatalf("post of another owner: %s", got)
	}
	// A locked post, or a `nobody` policy, closes replies before the block
	// check runs.
	f.exec(`INSERT INTO vetchium.hub_user_blocks (blocker_hub_user_did, blocked_hub_user_did,
            blocked_handle, blocked_tenant_id)
        VALUES ($1, $2, 'replier', 'sgp')`, owner, replier)
	locked := f.newPost(owner, `locked_at = now()`)
	if got := problemOf(t, register(locked, "")); got != "hub-post-replies-closed" {
		t.Fatalf("locked post: %s", got)
	}
	nobody := f.newPost(owner, `reply_policy = 'nobody'`)
	response := register(nobody, "")
	if got := problemOf(t, response); got != "hub-post-replies-closed" || response.Status != 409 {
		t.Fatalf("nobody policy: %s %d", got, response.Status)
	}
	open := f.newPost(owner, "")
	response = register(open, "")
	if got := problemOf(t, response); got != "hub-post-reply-refused" || response.Status != 403 {
		t.Fatalf("blocked replier: %s %d", got, response.Status)
	}
	// The block check runs before the parent check.
	if got := problemOf(t, register(open, f.newID())); got != "hub-post-reply-refused" {
		t.Fatalf("blocked replier with a parent: %s", got)
	}
	f.exec(`DELETE FROM vetchium.hub_user_blocks WHERE blocker_hub_user_did = $1`, owner)

	// Parent checks.
	if got := problemOf(t, register(open, f.newID())); got != "hub-reply-not-found" {
		t.Fatalf("unknown parent: %s", got)
	}
	topID := f.newID()
	if response := f.register(owner, f.payload(open, topID, "", replier)); response.Status != 200 {
		t.Fatalf("top-level reply: %d %s", response.Status, response.Body)
	}
	subID := f.newID()
	if response := f.register(owner, f.payload(open, subID, topID, replier)); response.Status != 200 {
		t.Fatalf("sub-reply: %d %s", response.Status, response.Body)
	}
	response = register(open, subID)
	if got := problemOf(t, response); got != "validation-failed" ||
		!strings.Contains(string(response.Body), "parent_reply_id") {
		t.Fatalf("reply to a sub-reply: %s %s", got, response.Body)
	}
	other := f.newPost(owner, "")
	if got := problemOf(t, register(other, topID)); got != "hub-reply-not-found" {
		t.Fatalf("parent in another post: %s", got)
	}
	f.exec(`UPDATE vetchium.hub_post_replies SET state = 'hidden_by_owner'
        WHERE post_id = $1 AND reply_id = $2`, open, topID)
	if got := problemOf(t, register(open, topID)); got != "hub-reply-not-found" {
		t.Fatalf("hidden parent: %s", got)
	}
	f.exec(`UPDATE vetchium.hub_post_replies SET state = 'author_removed', body = NULL
        WHERE post_id = $1 AND reply_id = $2`, open, topID)
	if got := problemOf(t, register(open, topID)); got != "hub-reply-not-found" {
		t.Fatalf("removed parent: %s", got)
	}
	// A refusal changes no count.
	if got := f.counts(open); got != "2" {
		t.Fatalf("reply count = %s", got)
	}
}

func TestRegisterCountsReplaysAndAuditsIntegration(t *testing.T) {
	f := newFixture(t)
	owner, replier := f.newUser(), f.newUser()
	post := f.newPost(owner, "")
	topID, subID := f.newID(), f.newID()
	commandID := dbvalue.FormatUUID(mustUUID(t))

	top := f.payload(post, topID, "", replier)
	response := f.registerAs(owner, commandID, top)
	var result federationspec.HubPostReplyRegisterResult
	if err := json.Unmarshal(response.Body, &result); err != nil ||
		response.Status != 200 || string(result.ReplyID) != topID ||
		result.CreatedAt.IsZero() {
		t.Fatalf("result = %d %s (%v)", response.Status, response.Body, err)
	}
	if got := f.counts(post); got != "1" {
		t.Fatalf("reply count = %s", got)
	}
	if got := f.copyState(post, topID); got != "live:a reply:1" {
		t.Fatalf("copy = %s", got)
	}
	if got := f.scalar(`SELECT author_tenant_id || ' ' || author_handle
        FROM vetchium.hub_post_replies WHERE reply_id = $1`, topID); got != "sgp "+string(handleOf(replier)) {
		t.Fatalf("author = %s", got)
	}

	// The same command replays its stored outcome and changes nothing.
	if again := f.registerAs(owner, commandID, top); again.Status != 200 {
		t.Fatalf("replay = %d", again.Status)
	}
	// The same reply under a new command id inserts no row and keeps counts.
	if again := f.register(owner, top); again.Status != 200 {
		t.Fatalf("redelivery = %d", again.Status)
	}
	if got := f.counts(post); got != "1" {
		t.Fatalf("reply count after redelivery = %s", got)
	}

	if response := f.register(owner, f.payload(post, subID, topID, replier)); response.Status != 200 {
		t.Fatalf("sub-reply = %d %s", response.Status, response.Body)
	}
	if got := f.counts(post); got != "2" {
		t.Fatalf("reply count = %s", got)
	}
	if got := f.childCounts(post, topID); got != "1/1" {
		t.Fatalf("child counts = %s", got)
	}

	audits := f.scalar(`SELECT count(*)::text || ' ' || bool_and(payload::text NOT LIKE '%a reply%')::text
        FROM vetchium.audit_events
        WHERE action = 'hub.post.reply-registered' AND entity_id = ANY($1)`,
		[]string{topID, subID})
	if audits != "2 true" {
		t.Fatalf("registered audit events = %s", audits)
	}
	if got := f.scalar(`SELECT count(*)::text FROM vetchium.audit_events
        WHERE action = 'hub.post.reply-registered' AND entity_id = $1`, topID); got != "1" {
		t.Fatalf("a replay or redelivery wrote %s audit events", got)
	}
}

func (f *fixture) send(
	owner, replier pgtype.UUID, post, reply string, key string, now time.Time,
) (commands.Outcome, error) {
	f.t.Helper()
	payload := f.payload(post, reply, "", replier)
	digest := sha256.Sum256([]byte(post + reply))
	return f.sender.Send(f.ctx, commands.Request{
		Kind: federationspec.HubPostReplyRegisterKind,
		Authority: commands.Principal{
			Type: directoryspec.PrincipalHubUser, DID: owner,
		},
		AggregateID: post,
		Owner: commands.Owner{
			Type: commands.OwnerHubUser, ID: dbvalue.FormatUUID(replier),
		},
		IdempotencyKey: common.IdempotencyKey(key), RequestDigest: digest[:],
		Payload: payload,
		Prepare: Prepare("sgp", now, NewReply{
			ReplierDID: replier, ReplyID: reply,
			Post: PostRef{
				OwnerDID: owner, OwnerHandle: string(handleOf(owner)),
				OwnerTenantID: "sgp", PostID: post,
			},
			Body: payload.Body,
		}),
	})
}

func (f *fixture) key() string {
	f.keys++
	return "hub-replies-idempotency-" + dbvalue.FormatUUID(mustUUID(f.t))
}

func (f *fixture) textState(reply string) string {
	f.t.Helper()
	var state string
	err := f.owner.QueryRow(f.ctx, `SELECT state::text || ':' || (operation_id IS NOT NULL)::text
        FROM vetchium.hub_reply_texts WHERE reply_id = $1`, reply).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return "gone"
	}
	if err != nil {
		f.t.Fatal(err)
	}
	return state
}

func (f *fixture) auditCount(action, entity string) string {
	return f.scalar(`SELECT count(*)::text FROM vetchium.audit_events
        WHERE action = $1 AND entity_id = $2`, action, entity)
}

func TestPrepareSettlesLiveOnSuccessAndReplayRunsItOnceIntegration(t *testing.T) {
	f := newFixture(t)
	owner, replier := f.newUser(), f.newUser()
	post := f.newPost(owner, "")
	reply, key := f.newID(), f.key()

	outcome, err := f.send(owner, replier, post, reply, key, time.Now())
	if err != nil || outcome.State != commands.StateSucceeded {
		t.Fatalf("outcome = %+v, %v", outcome, err)
	}
	if got := f.textState(reply); got != "live:false" {
		t.Fatalf("reply text = %s", got)
	}
	if got := f.counts(post); got != "1" {
		t.Fatalf("reply count = %s", got)
	}
	for action, want := range map[string]string{
		"hub.reply.created": "1", "hub.reply.settled": "1",
		"hub.reply.discarded": "0", "hub.post.reply-registered": "1",
	} {
		if got := f.auditCount(action, reply); got != want {
			t.Fatalf("%s events = %s, want %s", action, got, want)
		}
	}
	// A replay of the finished operation runs no hook again.
	if again, err := f.send(owner, replier, post, reply, key, time.Now()); err != nil ||
		again.State != commands.StateSucceeded {
		t.Fatalf("replay = %+v, %v", again, err)
	}
	if got := f.scalar(`SELECT count(*)::text FROM vetchium.hub_reply_texts
        WHERE reply_id = $1`, reply); got != "1" {
		t.Fatalf("reply texts = %s", got)
	}
	if got := f.auditCount("hub.reply.created", reply); got != "1" {
		t.Fatalf("created events after replay = %s", got)
	}
}

func TestSettleDiscardsAPendingReplyOnRejectionIntegration(t *testing.T) {
	f := newFixture(t)
	owner, replier := f.newUser(), f.newUser()
	f.exec(`INSERT INTO vetchium.hub_user_blocks (blocker_hub_user_did, blocked_hub_user_did,
            blocked_handle, blocked_tenant_id)
        VALUES ($1, $2, 'replier', 'sgp')`, owner, replier)
	post := f.newPost(owner, "")
	reply := f.newID()

	outcome, err := f.send(owner, replier, post, reply, f.key(), time.Now())
	if err != nil || outcome.State != commands.StateFailed ||
		outcome.Response.Status != 403 {
		t.Fatalf("outcome = %+v, %v", outcome, err)
	}
	if got := f.textState(reply); got != "gone" {
		t.Fatalf("reply text = %s", got)
	}
	for action, want := range map[string]string{
		"hub.reply.created": "1", "hub.reply.discarded": "1",
		"hub.reply.settled": "0", "hub.post.reply-registered": "0",
	} {
		if got := f.auditCount(action, reply); got != want {
			t.Fatalf("%s events = %s, want %s", action, got, want)
		}
	}
}

func TestSettleChangesNoRowInAnotherStateIntegration(t *testing.T) {
	f := newFixture(t)
	owner, replier := f.newUser(), f.newUser()
	post := f.newPost(owner, "")
	reply := f.newID()
	operation := mustUUID(t)
	f.exec(`INSERT INTO vetchium.hub_reply_texts (reply_id, author_hub_user_did,
            post_owner_hub_user_did, post_owner_handle, post_owner_tenant_id,
            post_id, body, state)
        VALUES ($1, $2, $3, 'owner', 'sgp', $4, 'kept', 'post_removed')`,
		reply, replier, owner, post)
	payload, _ := json.Marshal(f.payload(post, reply, "", replier))
	for _, state := range []commands.State{commands.StateSucceeded, commands.StateFailed} {
		tx, err := f.app.Begin(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		err = settle(f.ctx, tx, commands.Command{
			SourceTenantID: "sgp", Payload: payload,
		}, operation, commands.Outcome{OperationID: operation, State: state})
		if err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(f.ctx); err != nil {
			t.Fatal(err)
		}
	}
	if got := f.textState(reply); got != "post_removed:false" {
		t.Fatalf("reply text = %s", got)
	}
	if got := f.auditCount("hub.reply.settled", reply) + f.auditCount("hub.reply.discarded", reply); got != "00" {
		t.Fatalf("settle audited without a change: %s", got)
	}
}

func TestPrepareRefusesPastTheDailyCapIntegration(t *testing.T) {
	f := newFixture(t)
	owner, replier := f.newUser(), f.newUser()
	post := f.newPost(owner, "")
	f.exec(`INSERT INTO vetchium.hub_reply_texts (reply_id, author_hub_user_did,
            post_owner_hub_user_did, post_owner_handle, post_owner_tenant_id,
            post_id, body, state)
        SELECT md5($1::uuid::text || i::text) || substr(md5(i::text), 1, 8), $1, $2,
            'owner', 'sgp', $3, 'old', 'live'
        FROM generate_series(1, $4::int) AS i`,
		replier, owner, post, DailyLimit-1)
	reply := f.newID()
	if outcome, err := f.send(owner, replier, post, reply, f.key(), time.Now()); err != nil ||
		outcome.State != commands.StateSucceeded {
		t.Fatalf("reply 500 = %+v, %v", outcome, err)
	}
	over := f.newID()
	outcome, err := f.send(owner, replier, post, over, f.key(), time.Now())
	if err != nil || outcome.State != commands.StateFailed ||
		outcome.Response.Status != 429 {
		t.Fatalf("reply 501 = %+v, %v", outcome, err)
	}
	if got := f.textState(over); got != "gone" {
		t.Fatalf("refused reply text = %s", got)
	}
	if got := f.auditCount("hub.reply.created", over); got != "0" {
		t.Fatalf("a refused Prepare wrote %s events", got)
	}
	// Replies older than 24 hours do not count.
	if outcome, err := f.send(owner, replier, post, f.newID(), f.key(),
		time.Now().Add(25*time.Hour)); err != nil || outcome.State != commands.StateSucceeded {
		t.Fatalf("reply after the window = %+v, %v", outcome, err)
	}
}

// deliver applies one event at the post owner's or reply author's tenant.
func (f *fixture) deliver(
	kind federationspec.EventKind, destination pgtype.UUID,
	aggregate federationspec.AggregateType, aggregateID string, version int64,
	payload any,
) federationspec.EventDeliveryOutcome {
	f.t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		f.t.Fatal(err)
	}
	outcome, err := f.receiver.Receive(f.ctx, events.Event{
		EventID: mustUUID(f.t), SourceTenantID: "sgp", Kind: kind,
		Destination: events.Principal{
			Type: directoryspec.PrincipalHubUser, DID: destination,
		},
		AggregateType: aggregate, AggregateID: aggregateID,
		AggregateVersion: version, Payload: body,
	})
	if err != nil {
		f.t.Fatal(err)
	}
	return outcome
}

func (f *fixture) edited(
	owner, author pgtype.UUID, post, reply string, version int64, body string, revision int32,
) federationspec.EventDeliveryOutcome {
	return f.deliver(federationspec.HubReplyEditedKind, owner,
		federationspec.AggregateHubReply, reply, version,
		federationspec.HubReplyEditedPayload{
			PostID: hubposts.PostID(post), ReplyID: hubposts.PostID(reply),
			Body: body, Revision: revision, AuthorHubUserDID: didOf(author),
		})
}

func (f *fixture) removed(
	owner, author pgtype.UUID, post, reply string, version int64,
) federationspec.EventDeliveryOutcome {
	return f.deliver(federationspec.HubReplyRemovedKind, owner,
		federationspec.AggregateHubReply, reply, version,
		federationspec.HubReplyRemovedPayload{
			PostID: hubposts.PostID(post), ReplyID: hubposts.PostID(reply),
			AuthorHubUserDID: didOf(author),
		})
}

// thread registers a top-level reply and a sub-reply of replier.
func (f *fixture) thread(owner, replier pgtype.UUID) (post, top, sub string) {
	f.t.Helper()
	post, top, sub = f.newPost(owner, ""), f.newID(), f.newID()
	for _, payload := range []federationspec.HubPostReplyRegisterPayload{
		f.payload(post, top, "", replier), f.payload(post, sub, top, replier),
	} {
		if response := f.register(owner, payload); response.Status != 200 {
			f.t.Fatalf("register = %d %s", response.Status, response.Body)
		}
	}
	return post, top, sub
}

func TestReplyEditedUpdatesTheCopyIntegration(t *testing.T) {
	f := newFixture(t)
	owner, replier, stranger := f.newUser(), f.newUser(), f.newUser()
	post, top, _ := f.thread(owner, replier)

	if got := f.edited(owner, replier, post, top, 2, "edited words", 2); got != federationspec.EventApplied {
		t.Fatalf("edit = %s", got)
	}
	if got := f.copyState(post, top); got != "live:edited words:2" {
		t.Fatalf("copy = %s", got)
	}
	// An older revision, even at a newer event version, changes nothing.
	f.edited(owner, replier, post, top, 3, "older words", 1)
	if got := f.copyState(post, top); got != "live:edited words:2" {
		t.Fatalf("copy after an older revision = %s", got)
	}
	// An event from a user who does not own the reply changes nothing.
	f.edited(owner, stranger, post, top, 4, "forged words", 5)
	if got := f.copyState(post, top); got != "live:edited words:2" {
		t.Fatalf("copy after a forged edit = %s", got)
	}
	// An event for a reply that is not registered is applied without effect.
	f.edited(owner, replier, post, f.newID(), 1, "no such reply", 2)
}

func TestReplyRemovedClearsTheCopyAndAppliesTheCountRuleIntegration(t *testing.T) {
	f := newFixture(t)
	owner, replier := f.newUser(), f.newUser()
	post, top, sub := f.thread(owner, replier)

	if got := f.removed(owner, replier, post, sub, 2); got != federationspec.EventApplied {
		t.Fatalf("remove = %s", got)
	}
	if got := f.copyState(post, sub); got != "author_removed:-:1" {
		t.Fatalf("copy = %s", got)
	}
	if got := f.counts(post); got != "1" {
		t.Fatalf("reply count = %s", got)
	}
	// The row count never goes down, so a placeholder can stay.
	if got := f.childCounts(post, top); got != "0/1" {
		t.Fatalf("child counts = %s", got)
	}
	// A repeat changes no count.
	f.removed(owner, replier, post, sub, 3)
	if got := f.counts(post) + " " + f.childCounts(post, top); got != "1 0/1" {
		t.Fatalf("counts after a repeat = %s", got)
	}

	// A hidden reply already left the live count: removal changes nothing.
	f.exec(`UPDATE vetchium.hub_post_replies SET state = 'hidden_by_owner'
        WHERE post_id = $1 AND reply_id = $2`, post, top)
	f.exec(`UPDATE vetchium.hub_posts SET reply_count = reply_count - 1 WHERE post_id = $1`, post)
	f.removed(owner, replier, post, top, 2)
	if got := f.copyState(post, top); got != "author_removed:-:1" || f.counts(post) != "0" {
		t.Fatalf("hidden removal: copy %s, count %s", got, f.counts(post))
	}
}

func TestAnOlderEditAfterARemovalIsSupersededIntegration(t *testing.T) {
	f := newFixture(t)
	owner, replier := f.newUser(), f.newUser()
	post, top, _ := f.thread(owner, replier)

	if got := f.removed(owner, replier, post, top, 3); got != federationspec.EventApplied {
		t.Fatalf("remove = %s", got)
	}
	if got := f.edited(owner, replier, post, top, 2, "late words", 2); got != federationspec.EventSuperseded {
		t.Fatalf("late edit = %s", got)
	}
	if got := f.copyState(post, top); got != "author_removed:-:1" {
		t.Fatalf("copy = %s", got)
	}
}

func TestPostRemovedMarksOnlyPendingAndLiveRepliesIntegration(t *testing.T) {
	f := newFixture(t)
	owner, author, other := f.newUser(), f.newUser(), f.newUser()
	post := f.newPost(owner, "")
	ids := map[string]string{}
	for _, state := range []string{"pending", "live", "removed", "post_removed"} {
		id := f.newID()
		ids[state] = id
		body, operation := "'words'", "NULL::uuid"
		if state == "removed" {
			body = "NULL"
		}
		if state == "pending" {
			operation = "gen_random_uuid()"
		}
		f.exec(`INSERT INTO vetchium.hub_reply_texts (reply_id, author_hub_user_did,
                post_owner_hub_user_did, post_owner_handle, post_owner_tenant_id,
                post_id, operation_id, body, state)
            VALUES ($1, $2, $3, 'owner', 'sgp', $4, `+operation+`, `+body+`, $5)`,
			id, author, owner, post, state)
	}
	// Another author's reply on the same post is not this event's.
	bystander := f.newID()
	f.exec(`INSERT INTO vetchium.hub_reply_texts (reply_id, author_hub_user_did,
            post_owner_hub_user_did, post_owner_handle, post_owner_tenant_id,
            post_id, body, state)
        VALUES ($1, $2, $3, 'owner', 'sgp', $4, 'words', 'live')`,
		bystander, other, owner, post)

	got := f.deliver(federationspec.HubPostRemovedKind, author,
		federationspec.AggregateHubPost, post, 2,
		federationspec.HubPostRemovedPayload{
			PostID: hubposts.PostID(post), OwnerHubUserDID: didOf(owner),
		})
	if got != federationspec.EventApplied {
		t.Fatalf("post removed = %s", got)
	}
	for state, want := range map[string]string{
		"pending": "post_removed:false", "live": "post_removed:false",
		"removed": "removed:false", "post_removed": "post_removed:false",
	} {
		if got := f.textState(ids[state]); got != want {
			t.Fatalf("%s reply = %s, want %s", state, got, want)
		}
	}
	if got := f.textState(bystander); got != "live:false" {
		t.Fatalf("other author's reply = %s", got)
	}
}
