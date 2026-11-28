package hubreplies

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/hub"
	hubposts "github.com/vetchium/src/typespec/hub/posts"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/events"
)

// RegisterEvents adds the three reply event receivers to registry.
func RegisterEvents(registry *events.Registry) {
	registry.Register(federationspec.HubReplyEditedKind, applyEdited,
		payloadOrigin("author_hub_user_did"))
	registry.Register(federationspec.HubReplyRemovedKind, applyRemoved,
		payloadOrigin("author_hub_user_did"))
	// An edit delayed past a removal must not bring the copy back.
	registry.ShareWatermark(federationspec.HubReplyRemovedKind,
		federationspec.HubReplyEditedKind)
	registry.Register(federationspec.HubPostRemovedKind, applyPostRemoved,
		payloadOrigin("owner_hub_user_did"))
}

// payloadOrigin names the Hub user in the payload field as the origin of the
// event: only that user's home tenant may report on them (PST-RPL-015).
func payloadOrigin(field string) events.Origin {
	return func(event events.Event) (events.Principal, bool) {
		var payload map[string]json.RawMessage
		if json.Unmarshal(event.Payload, &payload) != nil {
			return events.Principal{}, false
		}
		var value string
		if json.Unmarshal(payload[field], &value) != nil {
			return events.Principal{}, false
		}
		did, err := dbvalue.ParseUUID(value)
		if err != nil {
			return events.Principal{}, false
		}
		return events.Principal{Type: directoryspec.PrincipalHubUser, DID: did}, true
	}
}

func decodeEvent(event events.Event, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(event.Payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil ||
		decoder.Decode(&struct{}{}) != io.EOF {
		return fmt.Errorf("decode %s payload: %v", event.Kind, err)
	}
	return nil
}

func checkEvent(
	event events.Event, aggregate federationspec.AggregateType, id string,
	fields []string,
) error {
	if event.Destination.Type != directoryspec.PrincipalHubUser ||
		event.AggregateType != aggregate {
		return fmt.Errorf("%s for %s %s", event.Kind,
			event.Destination.Type, event.AggregateType)
	}
	if len(fields) > 0 {
		return fmt.Errorf("invalid %s payload: %v", event.Kind, fields)
	}
	if event.AggregateID != id {
		return fmt.Errorf("%s aggregate %q does not match its payload",
			event.Kind, event.AggregateID)
	}
	return nil
}

// lockReply locks the post and the reply copy an author event names. ok is
// false when the event changes nothing: the post or the copy is gone, the
// destination does not own the post, or the reply is not the origin's.
func lockReply(
	ctx context.Context, q *sqlc.Queries, destination, author pgtype.UUID,
	postID, replyID string,
) (sqlc.VetchiumHubPostReply, bool, error) {
	post, err := q.GetHubPostForReply(ctx, postID)
	if isNoRows(err) {
		return sqlc.VetchiumHubPostReply{}, false, nil
	}
	if err != nil {
		return sqlc.VetchiumHubPostReply{}, false, fmt.Errorf("lock post: %w", err)
	}
	if post.AuthorHubUserDid != destination {
		return sqlc.VetchiumHubPostReply{}, false, nil
	}
	reply, err := q.GetHubPostReplyForUpdate(ctx,
		sqlc.GetHubPostReplyForUpdateParams{PostID: postID, ReplyID: replyID})
	if isNoRows(err) {
		return sqlc.VetchiumHubPostReply{}, false, nil
	}
	if err != nil {
		return sqlc.VetchiumHubPostReply{}, false, fmt.Errorf("lock reply: %w", err)
	}
	return reply, reply.AuthorHubUserDid == author, nil
}

// applyEdited updates the reply copy (PST-RPL-010).
func applyEdited(ctx context.Context, tx pgx.Tx, event events.Event) error {
	var payload federationspec.HubReplyEditedPayload
	if err := decodeEvent(event, &payload); err != nil {
		return err
	}
	if err := checkEvent(event, federationspec.AggregateHubReply,
		string(payload.ReplyID), payload.Validate()); err != nil {
		return err
	}
	author, err := dbvalue.ParseUUID(string(payload.AuthorHubUserDID))
	if err != nil {
		return err
	}
	q := sqlc.New(tx)
	_, ok, err := lockReply(ctx, q, event.Destination.DID, author,
		string(payload.PostID), string(payload.ReplyID))
	if err != nil || !ok {
		return err
	}
	if _, err := q.UpdateHubPostReplyCopy(ctx, sqlc.UpdateHubPostReplyCopyParams{
		Body: dbvalue.Text(payload.Body), Revision: payload.Revision,
		PostID: string(payload.PostID), ReplyID: string(payload.ReplyID),
	}); err != nil {
		return fmt.Errorf("update reply copy: %w", err)
	}
	return nil
}

// applyRemoved clears the reply copy and applies the count rule
// (PST-OWN-002, PST-RPL-014): only a reply that leaves live lowers a count.
func applyRemoved(ctx context.Context, tx pgx.Tx, event events.Event) error {
	var payload federationspec.HubReplyRemovedPayload
	if err := decodeEvent(event, &payload); err != nil {
		return err
	}
	if err := checkEvent(event, federationspec.AggregateHubReply,
		string(payload.ReplyID), payload.Validate()); err != nil {
		return err
	}
	author, err := dbvalue.ParseUUID(string(payload.AuthorHubUserDID))
	if err != nil {
		return err
	}
	q := sqlc.New(tx)
	_, ok, err := lockReply(ctx, q, event.Destination.DID, author,
		string(payload.PostID), string(payload.ReplyID))
	if err != nil || !ok {
		return err
	}
	cleared, err := q.ClearHubPostReplyCopy(ctx, sqlc.ClearHubPostReplyCopyParams{
		PostID: string(payload.PostID), ReplyID: string(payload.ReplyID),
	})
	if isNoRows(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("clear reply copy: %w", err)
	}
	if cleared.OldState != sqlc.VetchiumHubPostReplyStateLive {
		return nil
	}
	var childDelta int32
	if cleared.ParentReplyID.Valid {
		childDelta = -1
	}
	if _, err := q.AdjustHubPostReplyCounts(ctx, sqlc.AdjustHubPostReplyCountsParams{
		ReplyDelta: -1, PostID: string(payload.PostID),
		ChildDelta: childDelta, ParentReplyID: cleared.ParentReplyID,
	}); err != nil {
		return fmt.Errorf("adjust reply counts: %w", err)
	}
	return nil
}

// applyPostRemoved marks the destination author's pending and live replies on
// the removed post (PST-RPL-013).
func applyPostRemoved(ctx context.Context, tx pgx.Tx, event events.Event) error {
	var payload federationspec.HubPostRemovedPayload
	if err := decodeEvent(event, &payload); err != nil {
		return err
	}
	if err := checkEvent(event, federationspec.AggregateHubPost,
		string(payload.PostID), payload.Validate()); err != nil {
		return err
	}
	owner, err := dbvalue.ParseUUID(string(payload.OwnerHubUserDID))
	if err != nil {
		return err
	}
	if _, err := sqlc.New(tx).MarkHubRepliesPostRemoved(ctx,
		sqlc.MarkHubRepliesPostRemovedParams{
			AuthorHubUserDid: event.Destination.DID, PostOwnerHubUserDid: owner,
			PostID: string(payload.PostID),
		}); err != nil {
		return fmt.Errorf("mark replies post removed: %w", err)
	}
	return nil
}

// Edited is a reply edit the post owner's tenant must copy. Version is the
// reply text's version after the edit.
type Edited struct {
	PostID, ReplyID string
	PostOwnerDID    pgtype.UUID
	AuthorDID       pgtype.UUID
	Body            string
	Revision        int32
	Version         int64
}

// EnqueueEdited enqueues hub-reply-edited to the post owner. Call it through
// the transaction that commits the edit (PST-RPL-010).
func EnqueueEdited(ctx context.Context, q sqlc.Querier, edit Edited) error {
	_, err := events.Enqueue(ctx, q, events.Outgoing{
		Kind: federationspec.HubReplyEditedKind,
		Destination: events.Principal{
			Type: directoryspec.PrincipalHubUser, DID: edit.PostOwnerDID,
		},
		AggregateType:    federationspec.AggregateHubReply,
		AggregateID:      edit.ReplyID,
		AggregateVersion: edit.Version,
		Payload: federationspec.HubReplyEditedPayload{
			PostID: hubposts.PostID(edit.PostID), ReplyID: hubposts.PostID(edit.ReplyID),
			Body: edit.Body, Revision: edit.Revision,
			AuthorHubUserDID: hub.HubUserDID(dbvalue.FormatUUID(edit.AuthorDID)),
		},
	})
	return err
}

// Removed is a reply removal the post owner's tenant must apply. Version is
// the reply text's version after the removal.
type Removed struct {
	PostID, ReplyID string
	PostOwnerDID    pgtype.UUID
	AuthorDID       pgtype.UUID
	Version         int64
}

// EnqueueRemoved enqueues hub-reply-removed to the post owner. Call it
// through the transaction that commits the removal (PST-RPL-011).
func EnqueueRemoved(ctx context.Context, q sqlc.Querier, removal Removed) error {
	_, err := events.Enqueue(ctx, q, events.Outgoing{
		Kind: federationspec.HubReplyRemovedKind,
		Destination: events.Principal{
			Type: directoryspec.PrincipalHubUser, DID: removal.PostOwnerDID,
		},
		AggregateType:    federationspec.AggregateHubReply,
		AggregateID:      removal.ReplyID,
		AggregateVersion: removal.Version,
		Payload: federationspec.HubReplyRemovedPayload{
			PostID: hubposts.PostID(removal.PostID), ReplyID: hubposts.PostID(removal.ReplyID),
			AuthorHubUserDID: hub.HubUserDID(dbvalue.FormatUUID(removal.AuthorDID)),
		},
	})
	return err
}
