// Package hubquotes is the federation side of Hub quote posts
// (agent-guides/posts.md, Quotes). The quoter's tenant holds the quote post
// and enqueues an event; the target owner's tenant keeps the quote index and
// the quote count.
package hubquotes

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/hub"
	hubposts "github.com/vetchium/src/typespec/hub/posts"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/events"
	"backend/internal/hubreplies"
)

// RegisterEvents adds the two quote event receivers to registry. Their
// origin is the quoter, so only the quoter's home tenant reports on a quote.
func RegisterEvents(registry *events.Registry) {
	registry.Register(federationspec.HubPostQuotedKind, applyQuoted,
		hubreplies.PayloadOrigin("quoter_hub_user_did"))
	registry.Register(federationspec.HubPostUnquotedKind, applyUnquoted,
		hubreplies.PayloadOrigin("quoter_hub_user_did"))
	// A quoted event delayed past an unquoted one must not record the quote
	// again (PST-QTE-007).
	registry.ShareWatermark(federationspec.HubPostUnquotedKind,
		federationspec.HubPostQuotedKind)
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// applyQuoted records one quote under the target (PST-QTE-005). A policy or a
// block that refuses the quote now stores the row as detached, so the quote
// never shows and never counts.
func applyQuoted(ctx context.Context, tx pgx.Tx, event events.Event) error {
	var payload federationspec.HubPostQuotedPayload
	if err := hubreplies.DecodeEvent(event, &payload); err != nil {
		return err
	}
	if err := hubreplies.CheckEvent(event, federationspec.AggregateHubPost,
		string(payload.QuotePostID), payload.Validate()); err != nil {
		return err
	}
	quoter, err := dbvalue.ParseUUID(string(payload.QuoterHubUserDID))
	if err != nil {
		return err
	}
	q := sqlc.New(tx)
	target, err := q.GetHubPostForQuote(ctx, string(payload.TargetPostID))
	if isNoRows(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read quote target: %w", err)
	}
	if target.AuthorHubUserDid != event.Destination.DID ||
		target.State != sqlc.VetchiumHubPostStateLive {
		return nil
	}
	blocked, err := q.HubUserBlockExists(ctx, sqlc.HubUserBlockExistsParams{
		BlockerHubUserDid: target.AuthorHubUserDid, BlockedHubUserDid: quoter,
	})
	if err != nil {
		return fmt.Errorf("read quoter block: %w", err)
	}
	detached := blocked ||
		target.QuotePolicy != sqlc.VetchiumHubPostPolicyEveryone
	inserted, err := q.InsertHubPostQuote(ctx, sqlc.InsertHubPostQuoteParams{
		TargetPostID: string(payload.TargetPostID), QuoterHubUserDid: quoter,
		QuoterHandle: string(payload.QuoterHandle), QuoterTenantID: event.SourceTenantID,
		QuotePostID: string(payload.QuotePostID), Detached: detached,
	})
	if err != nil {
		return fmt.Errorf("insert quote: %w", err)
	}
	if inserted == 1 && !detached {
		if _, err := q.IncrementHubPostQuoteCount(
			ctx, string(payload.TargetPostID)); err != nil {
			return fmt.Errorf("increment quote count: %w", err)
		}
	}
	return nil
}

// applyUnquoted deletes the quote row and reduces the count only for a quote
// that was not detached (PST-QTE-006). A row of another quoter stays.
func applyUnquoted(ctx context.Context, tx pgx.Tx, event events.Event) error {
	var payload federationspec.HubPostUnquotedPayload
	if err := hubreplies.DecodeEvent(event, &payload); err != nil {
		return err
	}
	if err := hubreplies.CheckEvent(event, federationspec.AggregateHubPost,
		string(payload.QuotePostID), payload.Validate()); err != nil {
		return err
	}
	quoter, err := dbvalue.ParseUUID(string(payload.QuoterHubUserDID))
	if err != nil {
		return err
	}
	q := sqlc.New(tx)
	target, err := q.GetHubPostForQuote(ctx, string(payload.TargetPostID))
	if isNoRows(err) || (err == nil &&
		target.AuthorHubUserDid != event.Destination.DID) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read quote target: %w", err)
	}
	row, err := q.GetHubPostQuote(ctx, sqlc.GetHubPostQuoteParams{
		TargetPostID: string(payload.TargetPostID),
		QuotePostID:  string(payload.QuotePostID),
	})
	if isNoRows(err) || (err == nil && row.QuoterHubUserDid != quoter) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read quote: %w", err)
	}
	deleted, err := q.DeleteHubPostQuote(ctx, sqlc.DeleteHubPostQuoteParams{
		TargetPostID: string(payload.TargetPostID),
		QuotePostID:  string(payload.QuotePostID),
	})
	if isNoRows(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("delete quote: %w", err)
	}
	if !deleted.Valid {
		if _, err := q.DecrementHubPostQuoteCount(
			ctx, string(payload.TargetPostID)); err != nil {
			return fmt.Errorf("decrement quote count: %w", err)
		}
	}
	return nil
}

// Quoted is a quote post whose target owner's tenant must record it. Version
// is the quote post's version.
type Quoted struct {
	TargetOwnerDID pgtype.UUID
	TargetPostID   string
	QuotePostID    string
	QuoterDID      pgtype.UUID
	QuoterHandle   string
	CreatedAt      time.Time
	Version        int64
}

// EnqueueQuoted enqueues hub-post-quoted to the target owner. Call it through
// the transaction that inserts the quote post (PST-QTE-004).
func EnqueueQuoted(ctx context.Context, q sqlc.Querier, quote Quoted) error {
	_, err := events.Enqueue(ctx, q, events.Outgoing{
		Kind: federationspec.HubPostQuotedKind,
		Destination: events.Principal{
			Type: directoryspec.PrincipalHubUser, DID: quote.TargetOwnerDID,
		},
		AggregateType:    federationspec.AggregateHubPost,
		AggregateID:      quote.QuotePostID,
		AggregateVersion: quote.Version,
		Payload: federationspec.HubPostQuotedPayload{
			TargetPostID: hubposts.PostID(quote.TargetPostID),
			QuotePostID:  hubposts.PostID(quote.QuotePostID),
			QuoterHubUserDID: hub.HubUserDID(
				dbvalue.FormatUUID(quote.QuoterDID)),
			QuoterHandle: hub.HubHandle(quote.QuoterHandle),
			CreatedAt:    quote.CreatedAt.UTC(),
		},
	})
	return err
}

// Unquoted is a removed quote post whose target owner's tenant must drop its
// row. Version is the quote post's version after the removal.
type Unquoted struct {
	TargetOwnerDID pgtype.UUID
	TargetPostID   string
	QuotePostID    string
	QuoterDID      pgtype.UUID
	Version        int64
}

// EnqueueUnquoted enqueues hub-post-unquoted to the target owner. Call it
// through the transaction that removes the quote post (PST-QTE-006).
func EnqueueUnquoted(ctx context.Context, q sqlc.Querier, removal Unquoted) error {
	_, err := events.Enqueue(ctx, q, events.Outgoing{
		Kind: federationspec.HubPostUnquotedKind,
		Destination: events.Principal{
			Type: directoryspec.PrincipalHubUser, DID: removal.TargetOwnerDID,
		},
		AggregateType:    federationspec.AggregateHubPost,
		AggregateID:      removal.QuotePostID,
		AggregateVersion: removal.Version,
		Payload: federationspec.HubPostUnquotedPayload{
			TargetPostID: hubposts.PostID(removal.TargetPostID),
			QuotePostID:  hubposts.PostID(removal.QuotePostID),
			QuoterHubUserDID: hub.HubUserDID(
				dbvalue.FormatUUID(removal.QuoterDID)),
		},
	})
	return err
}
