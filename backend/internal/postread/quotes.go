package postread

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	postsspec "github.com/vetchium/src/typespec/hub/posts"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

// ErrQuoteRefused reports a quote target whose policy or owner refuses the
// quoter (PST-QTE-003).
var ErrQuoteRefused = errors.New("quote refused")

// liveTarget checks that owner homes a live post with this ID. It returns
// ErrPostNotFound otherwise.
func (r Reader) liveTarget(
	ctx context.Context, owner pgtype.UUID, id string,
) (sqlc.GetHubPostForQuoteRow, error) {
	target, err := r.Queries.GetHubPostForQuote(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) ||
		(err == nil && (target.AuthorHubUserDid != owner ||
			target.State != sqlc.VetchiumHubPostStateLive)) {
		return target, ErrPostNotFound
	}
	return target, err
}

// QuoteTarget reads the post a viewer wants to quote, if its owner allows it
// (PST-QTE-003). It returns ErrPostNotFound for a post that is not live or
// not the owner's, and ErrQuoteRefused when the policy is `nobody` or the
// owner blocked the viewer.
func (r Reader) QuoteTarget(
	ctx context.Context, owner pgtype.UUID, id string, viewer pgtype.UUID,
) (postsspec.Post, error) {
	target, err := r.liveTarget(ctx, owner, id)
	if err != nil {
		return postsspec.Post{}, err
	}
	if target.QuotePolicy != sqlc.VetchiumHubPostPolicyEveryone {
		return postsspec.Post{}, ErrQuoteRefused
	}
	blocked, err := r.Queries.HubUserBlockExists(ctx, sqlc.HubUserBlockExistsParams{
		BlockerHubUserDid: owner, BlockedHubUserDid: viewer,
	})
	if err != nil {
		return postsspec.Post{}, err
	}
	if blocked {
		return postsspec.Post{}, ErrQuoteRefused
	}
	found, err := r.Get(ctx, owner, []postsspec.PostID{postsspec.PostID(id)})
	if err != nil {
		return postsspec.Post{}, err
	}
	if len(found) != 1 {
		return postsspec.Post{}, ErrPostNotFound
	}
	return found[0], nil
}

// Embeds reads the targets of embeds this tenant homes (PST-QTE-009). An
// item is `unavailable` when the target is not live, the quote row is
// missing or detached, or the quoter does not match.
func (r Reader) Embeds(
	ctx context.Context, items []postsspec.MeshEmbedReference,
) ([]postsspec.MeshEmbedResult, error) {
	results := make([]postsspec.MeshEmbedResult, len(items))
	for index, item := range items {
		results[index] = postsspec.MeshEmbedResult{
			Status:       postsspec.MeshEmbedUnavailable,
			TargetPostID: item.TargetPostID, QuotePostID: item.QuotePostID,
		}
		owner, err := dbvalue.ParseUUID(string(item.OwnerHubUserDID))
		if err != nil {
			return nil, err
		}
		quoter, err := dbvalue.ParseUUID(string(item.QuoterHubUserDID))
		if err != nil {
			return nil, err
		}
		if _, err := r.liveTarget(ctx, owner, string(item.TargetPostID)); err != nil {
			if errors.Is(err, ErrPostNotFound) {
				continue
			}
			return nil, err
		}
		quote, err := r.Queries.GetHubPostQuote(ctx, sqlc.GetHubPostQuoteParams{
			TargetPostID: string(item.TargetPostID),
			QuotePostID:  string(item.QuotePostID),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if quote.DetachedAt.Valid || quote.QuoterHubUserDid != quoter {
			continue
		}
		found, err := r.Get(ctx, owner, []postsspec.PostID{item.TargetPostID})
		if err != nil {
			return nil, err
		}
		if len(found) == 1 {
			results[index].Status = postsspec.MeshEmbedPost
			results[index].Post = &postsspec.MeshPost{
				Post: found[0], OwnerHubUserDID: item.OwnerHubUserDID,
			}
		}
	}
	return results, nil
}

// Quotes lists one page of the quotes of a live post of an owner this tenant
// homes, newest first (PST-QTE-012). It returns ErrPostNotFound for a post
// that is not live or not the owner's, and ErrInvalidKey for a key it did not
// issue.
func (r Reader) Quotes(
	ctx context.Context, owner pgtype.UUID, id string,
	key *common.PaginationKey, limit int32,
) ([]postsspec.MeshQuoteReference, *common.PaginationKey, error) {
	if _, err := r.liveTarget(ctx, owner, id); err != nil {
		return nil, nil, err
	}
	params := sqlc.ListHubPostQuotesParams{
		TargetPostID: id, PageLimit: limit + 1,
	}
	if key != nil {
		c, err := decodeKey(*key)
		if err != nil {
			return nil, nil, err
		}
		params.BeforeCreatedAt = pgtype.Timestamptz{Time: c.At, Valid: true}
		params.BeforeQuotePostID = pgtype.Text{String: c.PostID, Valid: true}
	}
	rows, err := r.Queries.ListHubPostQuotes(ctx, params)
	if err != nil {
		return nil, nil, err
	}
	quotes := []postsspec.MeshQuoteReference{}
	var next *common.PaginationKey
	for index, row := range rows {
		if index == int(limit) {
			last := rows[index-1]
			encoded, err := encodeKey(cursor{
				At: last.CreatedAt.Time.UTC(), PostID: last.QuotePostID,
			})
			if err != nil {
				return nil, nil, err
			}
			next = &encoded
			break
		}
		quotes = append(quotes, postsspec.MeshQuoteReference{
			QuoterHubUserDID: hubspec.HubUserDID(dbvalue.FormatUUID(row.QuoterHubUserDid)),
			QuoterHandle:     hubspec.HubHandle(row.QuoterHandle),
			QuoterTenantID:   directoryspec.TenantID(row.QuoterTenantID),
			QuotePostID:      postsspec.PostID(row.QuotePostID),
			CreatedAt:        row.CreatedAt.Time.UTC(),
		})
	}
	return quotes, next, nil
}
