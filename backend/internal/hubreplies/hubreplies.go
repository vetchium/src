// Package hubreplies is the federation side of Hub post replies
// (agent-guides/posts.md, Replies). The replier's tenant prepares and settles
// the pending reply text; the post owner's tenant registers the reply in the
// post's structure and keeps the reply copy. Edits, removals, and post
// cleanup reach the other tenant as events.
package hubreplies

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
)

const (
	// DailyLimit is the most replies of any state one user writes in a
	// rolling 24 hours (PST-RPL-001).
	DailyLimit = 500
	// Window is the rolling period of DailyLimit.
	Window = 24 * time.Hour
)

// Register adds the reply command and its Settle hook to registry.
func Register(registry *commands.Registry) {
	registry.Register(federationspec.HubPostReplyRegisterKind, handleRegister,
		Replier)
	registry.RegisterSettle(federationspec.HubPostReplyRegisterKind, settle)
}

// Replier is the initiator of hub-post-reply-register: the replier the
// payload names, who alone may write a reply in their own name.
func Replier(command commands.Command) (commands.Principal, bool) {
	var payload struct {
		ReplierHubUserDID string `json:"replier_hub_user_did"`
	}
	if json.Unmarshal(command.Payload, &payload) != nil {
		return commands.Principal{}, false
	}
	did, err := dbvalue.ParseUUID(payload.ReplierHubUserDID)
	if err != nil {
		return commands.Principal{}, false
	}
	return commands.Principal{Type: directoryspec.PrincipalHubUser, DID: did}, true
}

func validationFailed(fields ...string) commands.Result {
	details := problem.ValidationFailedError
	details.Fields = fields
	return commands.Rejected(details)
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// auditEvent is one audit record. It never holds words (PST-GEN-004).
type auditEvent struct {
	tenantID, action, replyID, source string
	actorDID, subjectDID              pgtype.UUID
	idempotencyKey                    string
	payload                           map[string]any
}

func writeAudit(ctx context.Context, q *sqlc.Queries, event auditEvent) error {
	payload := map[string]any{"schema_version": 1}
	for key, value := range event.payload {
		payload[key] = value
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	actorType, actorID := "hub_user", dbvalue.FormatUUID(event.actorDID)
	if !event.actorDID.Valid {
		actorType, actorID = "worker", "workers"
	}
	var key pgtype.Text
	if event.idempotencyKey != "" {
		key = dbvalue.Text(event.idempotencyKey)
	}
	if err := q.InsertHubPostAuditEvent(ctx, sqlc.InsertHubPostAuditEventParams{
		TenantID: event.tenantID, Action: event.action, EntityType: "hub_reply",
		EntityID: event.replyID, ActorType: actorType, ActorID: actorID,
		SubjectHubUserDid: event.subjectDID, Source: event.source,
		IdempotencyKey: key, Payload: encoded,
	}); err != nil {
		return fmt.Errorf("write audit event %s: %w", event.action, err)
	}
	return nil
}

// PostRef names the post a reply answers, as the replier's tenant resolved
// it. The owner's handle and tenant are routing hints only (PST-OWN-003).
type PostRef struct {
	OwnerDID      pgtype.UUID
	OwnerHandle   string
	OwnerTenantID string
	PostID        string
}

// NewReply is what Prepare stores for a reply that is about to be sent.
type NewReply struct {
	ReplierDID    pgtype.UUID
	ReplyID       string
	Post          PostRef
	ParentReplyID *string
	Body          string
}

// Prepare returns the hook that stores the pending reply text in the
// transaction that creates the command operation (PST-RPL-001, PST-RPL-006).
// A replay of the same operation never runs it again. now fixes the start of
// the 24-hour count.
func Prepare(tenantID string, now time.Time, reply NewReply) commands.PrepareFunc {
	return func(
		ctx context.Context, tx pgx.Tx, operationID pgtype.UUID,
	) (*problem.Details, error) {
		q := sqlc.New(tx)
		// The lock makes the cap and the insert agree for one replier.
		if _, err := q.LockHubUserForPosting(ctx, reply.ReplierDID); err != nil {
			return nil, fmt.Errorf("lock replier: %w", err)
		}
		count, err := q.CountHubRepliesSince(ctx, sqlc.CountHubRepliesSinceParams{
			AuthorHubUserDid: reply.ReplierDID,
			Since:            dbvalue.Timestamp(now.Add(-Window)),
		})
		if err != nil {
			return nil, fmt.Errorf("count recent replies: %w", err)
		}
		if count >= DailyLimit {
			refusal := hubproblem.HubPostLimitReachedError
			return &refusal, nil
		}
		var parent pgtype.Text
		if reply.ParentReplyID != nil {
			parent = dbvalue.Text(*reply.ParentReplyID)
		}
		if err := q.InsertPendingHubReplyText(ctx, sqlc.InsertPendingHubReplyTextParams{
			ReplyID: reply.ReplyID, AuthorHubUserDid: reply.ReplierDID,
			PostOwnerHubUserDid: reply.Post.OwnerDID,
			PostOwnerHandle:     reply.Post.OwnerHandle,
			PostOwnerTenantID:   reply.Post.OwnerTenantID,
			PostID:              reply.Post.PostID, ParentReplyID: parent,
			OperationID: operationID, Body: dbvalue.Text(reply.Body),
		}); err != nil {
			return nil, fmt.Errorf("insert pending reply text: %w", err)
		}
		return nil, writeAudit(ctx, q, auditEvent{
			tenantID: tenantID, action: "hub.reply.created",
			replyID: reply.ReplyID, source: "hub-api",
			actorDID: reply.ReplierDID, subjectDID: reply.ReplierDID,
			idempotencyKey: dbvalue.FormatUUID(operationID),
			payload:        map[string]any{"has_parent": reply.ParentReplyID != nil},
		})
	}
}

// settle turns the pending reply text live on success and deletes it on a
// rejection or an abandon (PST-RPL-008). It changes no row in another state,
// and audits only when a row changed.
func settle(
	ctx context.Context, tx pgx.Tx, command commands.Command,
	operationID pgtype.UUID, outcome commands.Outcome,
) error {
	var payload federationspec.HubPostReplyRegisterPayload
	if err := json.Unmarshal(command.Payload, &payload); err != nil {
		return fmt.Errorf("decode reply payload: %w", err)
	}
	replier, err := dbvalue.ParseUUID(string(payload.ReplierHubUserDID))
	if err != nil {
		return fmt.Errorf("parse replier: %w", err)
	}
	q := sqlc.New(tx)
	var rows int64
	var action string
	switch outcome.State {
	case commands.StateSucceeded:
		rows, err = q.SettleHubReplyTextLive(ctx, operationID)
		action = "hub.reply.settled"
	case commands.StateFailed, commands.StateUnavailable:
		rows, err = q.DeletePendingHubReplyText(ctx, operationID)
		action = "hub.reply.discarded"
	default:
		return nil
	}
	if err != nil {
		return fmt.Errorf("settle pending reply text: %w", err)
	}
	if rows == 0 {
		return nil
	}
	return writeAudit(ctx, q, auditEvent{
		tenantID: command.SourceTenantID, action: action,
		replyID: string(payload.ReplyID), source: "hub-api",
		actorDID: replier, subjectDID: replier,
		idempotencyKey: dbvalue.FormatUUID(operationID),
	})
}

// handleRegister runs at the post owner's tenant (PST-RPL-003, PST-RPL-007).
func handleRegister(
	ctx context.Context, tx pgx.Tx, command commands.Command,
) (commands.Result, error) {
	var payload federationspec.HubPostReplyRegisterPayload
	decoder := json.NewDecoder(bytes.NewReader(command.Payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil ||
		decoder.Decode(&struct{}{}) != io.EOF {
		return validationFailed("payload"), nil
	}
	if command.Authority.Type != directoryspec.PrincipalHubUser {
		return validationFailed("authority_principal_type"), nil
	}
	payload.Normalize()
	if fields := payload.Validate(); len(fields) > 0 {
		return validationFailed(fields...), nil
	}
	if command.AggregateID != string(payload.PostID) {
		return validationFailed("aggregate_id"), nil
	}
	replier, err := dbvalue.ParseUUID(string(payload.ReplierHubUserDID))
	if err != nil {
		return commands.Result{}, err
	}
	q := sqlc.New(tx)

	post, err := q.GetHubPostForReply(ctx, string(payload.PostID))
	if isNoRows(err) {
		return commands.Rejected(hubproblem.HubPostNotFoundError), nil
	}
	if err != nil {
		return commands.Result{}, fmt.Errorf("lock post: %w", err)
	}
	switch {
	case post.AuthorHubUserDid != command.Authority.DID ||
		post.State != sqlc.VetchiumHubPostStateLive:
		return commands.Rejected(hubproblem.HubPostNotFoundError), nil
	case post.LockedAt.Valid ||
		post.ReplyPolicy == sqlc.VetchiumHubPostPolicyNobody:
		return commands.Rejected(hubproblem.HubPostRepliesClosedError), nil
	}
	blocked, err := q.HubUserBlockExists(ctx, sqlc.HubUserBlockExistsParams{
		BlockerHubUserDid: post.AuthorHubUserDid, BlockedHubUserDid: replier,
	})
	if err != nil {
		return commands.Result{}, fmt.Errorf("check owner block: %w", err)
	}
	if blocked {
		return commands.Rejected(hubproblem.HubPostReplyRefusedError), nil
	}

	var parent pgtype.Text
	if payload.ParentReplyID != nil {
		parentRow, err := q.GetHubPostReplyForUpdate(ctx,
			sqlc.GetHubPostReplyForUpdateParams{
				PostID: string(payload.PostID), ReplyID: string(*payload.ParentReplyID),
			})
		if isNoRows(err) {
			return commands.Rejected(hubproblem.HubReplyNotFoundError), nil
		}
		if err != nil {
			return commands.Result{}, fmt.Errorf("lock parent reply: %w", err)
		}
		if parentRow.State != sqlc.VetchiumHubPostReplyStateLive {
			return commands.Rejected(hubproblem.HubReplyNotFoundError), nil
		}
		// A reply to a sub-reply is refused (PST-RPL-002).
		if parentRow.ParentReplyID.Valid {
			return validationFailed("parent_reply_id"), nil
		}
		parent = dbvalue.Text(string(*payload.ParentReplyID))
	}

	inserted, err := q.InsertHubPostReply(ctx, sqlc.InsertHubPostReplyParams{
		PostID: string(payload.PostID), ReplyID: string(payload.ReplyID),
		ParentReplyID: parent, AuthorHubUserDid: replier,
		AuthorHandle:   string(payload.ReplierHandle),
		AuthorTenantID: command.SourceTenantID,
		Body:           dbvalue.Text(payload.Body),
	})
	if err != nil {
		return commands.Result{}, fmt.Errorf("insert reply: %w", err)
	}
	// A redelivered command inserts nothing and changes no count.
	if inserted > 0 {
		var childDelta int32
		if parent.Valid {
			childDelta = 1
		}
		if _, err := q.AdjustHubPostReplyCounts(ctx, sqlc.AdjustHubPostReplyCountsParams{
			ReplyDelta: 1, PostID: string(payload.PostID),
			ChildDelta: childDelta, ChildRowDelta: childDelta,
			ParentReplyID: parent,
		}); err != nil {
			return commands.Result{}, fmt.Errorf("adjust reply counts: %w", err)
		}
		if err := writeAudit(ctx, q, auditEvent{
			tenantID: command.TenantID, action: "hub.post.reply-registered",
			replyID: string(payload.ReplyID), source: "federation-command",
			actorDID: replier, subjectDID: command.Authority.DID,
			idempotencyKey: dbvalue.FormatUUID(command.CommandID),
			payload: map[string]any{
				"post_id": string(payload.PostID), "has_parent": parent.Valid,
			},
		}); err != nil {
			return commands.Result{}, err
		}
	}
	return commands.Succeeded(200, federationspec.HubPostReplyRegisterResult{
		ReplyID: payload.ReplyID, CreatedAt: payload.CreatedAt,
	}), nil
}
