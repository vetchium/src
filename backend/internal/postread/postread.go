// Package postread reads timeline posts and owner cards from this tenant's
// database for the tenant's own Hub API and for the mesh handlers that serve
// other tenants (agent-guides/posts.md, "Reads").
package postread

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	postsspec "github.com/vetchium/src/typespec/hub/posts"
	profilespec "github.com/vetchium/src/typespec/hub/profile"

	"backend/internal/db/sqlc"
)

// ErrInvalidKey reports a pagination key this package did not issue.
var ErrInvalidKey = errors.New("invalid pagination key")

// PictureSigner signs a short-lived read URL for a profile picture.
type PictureSigner interface {
	SignGet(context.Context, pgtype.UUID) (string, error)
}

type Reader struct {
	Queries  sqlc.Querier
	Pictures PictureSigner
}

type cardRow struct {
	handle          string
	alias           pgtype.Text
	displayName     string
	pictureObjectID pgtype.UUID
}

func (r Reader) card(ctx context.Context, row cardRow) (profilespec.ProfileCard, error) {
	card := profilespec.ProfileCard{
		Handle:      hubspec.HubHandle(row.handle),
		DisplayName: common.DisplayName(row.displayName),
	}
	if row.alias.Valid {
		alias := directoryspec.HubAlias(row.alias.String)
		card.Alias = &alias
	}
	if row.pictureObjectID.Valid {
		if r.Pictures == nil {
			return card, errors.New("profile picture URL signer unavailable")
		}
		url, err := r.Pictures.SignGet(ctx, row.pictureObjectID)
		if err != nil {
			return card, fmt.Errorf("sign profile picture: %w", err)
		}
		card.PictureURL = &url
	}
	return card, nil
}

// Card reads the card of one active user this tenant homes. It returns
// pgx.ErrNoRows for any other user.
func (r Reader) Card(
	ctx context.Context, did pgtype.UUID,
) (profilespec.ProfileCard, error) {
	row, err := r.Queries.GetHubCardByDID(ctx, did)
	if err != nil {
		return profilespec.ProfileCard{}, err
	}
	return r.card(ctx, cardRow{
		row.Handle, row.ProfileAlias, row.DisplayName, row.PictureObjectID,
	})
}

// CardsByHandles reads the cards of the listed permanent handles this tenant
// homes. A handle it does not home is missing from the result.
func (r Reader) CardsByHandles(
	ctx context.Context, handles []hubspec.HubHandle,
) ([]profilespec.ProfileCard, error) {
	names := make([]string, len(handles))
	for index, handle := range handles {
		names[index] = string(handle)
	}
	rows, err := r.Queries.GetHubCardsByHandles(ctx, names)
	if err != nil {
		return nil, err
	}
	cards := make([]profilespec.ProfileCard, 0, len(rows))
	for _, row := range rows {
		card, err := r.card(ctx, cardRow{
			row.Handle, row.ProfileAlias, row.DisplayName, row.PictureObjectID,
		})
		if err != nil {
			return nil, err
		}
		cards = append(cards, card)
	}
	return cards, nil
}

func owner(card profilespec.ProfileCard) postsspec.PostOwner {
	return postsspec.PostOwner{
		Handle: card.Handle, Alias: card.Alias,
		DisplayName: card.DisplayName, PictureURL: card.PictureURL,
	}
}

func post(
	card profilespec.ProfileCard, row sqlc.GetHubPostsByIDsRow,
) postsspec.Post {
	result := postsspec.Post{
		PostID:      postsspec.PostID(row.PostID),
		Owner:       owner(card),
		Kind:        postsspec.PostKind(row.Kind),
		Body:        row.Body.String,
		ReplyPolicy: postsspec.ReplyPolicy(row.ReplyPolicy),
		QuotePolicy: postsspec.QuotePolicy(row.QuotePolicy),
		Locked:      row.LockedAt.Valid,
		ReplyCount:  row.ReplyCount,
		QuoteCount:  row.QuoteCount,
		Revision:    row.Revision,
		Edited:      row.Revision > 1,
		CreatedAt:   row.CreatedAt.Time.UTC(),
	}
	if row.EditedAt.Valid {
		editedAt := row.EditedAt.Time.UTC()
		result.EditedAt = &editedAt
	}
	return result
}

// Get reads the live posts of one author this tenant homes. It returns
// pgx.ErrNoRows when the tenant does not home the author. Posts that are not
// live are missing from the result.
func (r Reader) Get(
	ctx context.Context, did pgtype.UUID, ids []postsspec.PostID,
) ([]postsspec.Post, error) {
	card, err := r.Card(ctx, did)
	if err != nil {
		return nil, err
	}
	names := make([]string, len(ids))
	for index, id := range ids {
		names[index] = string(id)
	}
	rows, err := r.Queries.GetHubPostsByIDs(ctx, sqlc.GetHubPostsByIDsParams{
		AuthorHubUserDid: did, PostIds: names,
	})
	if err != nil {
		return nil, err
	}
	posts := make([]postsspec.Post, len(rows))
	for index, row := range rows {
		posts[index] = post(card, row)
	}
	return posts, nil
}

// cursor is the position after the last post of a page. It holds no secret:
// a forged one only moves the position in the owner's public list.
type cursor struct {
	At     time.Time `json:"at"`
	PostID string    `json:"post_id"`
}

func encodeKey(c cursor) (common.PaginationKey, error) {
	payload, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	return common.PaginationKey(
		base64.RawURLEncoding.EncodeToString(payload)), nil
}

func decodeKey(key common.PaginationKey) (cursor, error) {
	payload, err := base64.RawURLEncoding.DecodeString(string(key))
	var c cursor
	if err != nil || json.Unmarshal(payload, &c) != nil ||
		c.At.IsZero() || !postsspec.IsPostID(postsspec.PostID(c.PostID)) {
		return cursor{}, ErrInvalidKey
	}
	return c, nil
}

// List reads one page of the live posts of an author this tenant homes,
// newest first (PST-POS-011). It returns pgx.ErrNoRows when the tenant does
// not home the author and ErrInvalidKey for a key it did not issue.
func (r Reader) List(
	ctx context.Context, did pgtype.UUID, key *common.PaginationKey,
	limit int32,
) ([]postsspec.Post, *common.PaginationKey, error) {
	params := sqlc.ListHubPostsByAuthorParams{
		AuthorHubUserDid: did, PageLimit: limit + 1,
	}
	if key != nil {
		c, err := decodeKey(*key)
		if err != nil {
			return nil, nil, err
		}
		params.BeforeCreatedAt = pgtype.Timestamptz{Time: c.At, Valid: true}
		params.BeforePostID = pgtype.Text{String: c.PostID, Valid: true}
	}
	card, err := r.Card(ctx, did)
	if err != nil {
		return nil, nil, err
	}
	rows, err := r.Queries.ListHubPostsByAuthor(ctx, params)
	if err != nil {
		return nil, nil, err
	}
	posts := []postsspec.Post{}
	var next *common.PaginationKey
	for index, row := range rows {
		if index == int(limit) {
			last := rows[index-1]
			encoded, err := encodeKey(cursor{
				At: last.CreatedAt.Time.UTC(), PostID: last.PostID,
			})
			if err != nil {
				return nil, nil, err
			}
			next = &encoded
			break
		}
		posts = append(posts, post(card, sqlc.GetHubPostsByIDsRow(row)))
	}
	return posts, next, nil
}
