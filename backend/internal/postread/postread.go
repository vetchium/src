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
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	postsspec "github.com/vetchium/src/typespec/hub/posts"
	profilespec "github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs"

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
	result.QuoteTarget = quoteTarget(row)
	return result
}

// quoteTarget shapes the stored target of a quote post. The address of a
// timeline target is the permanent handle (PST-OWN-004).
func quoteTarget(row sqlc.GetHubPostsByIDsRow) *postsspec.QuoteTarget {
	if !row.QuoteTargetType.Valid {
		return nil
	}
	switch row.QuoteTargetType.VetchiumHubQuoteTargetType {
	case sqlc.VetchiumHubQuoteTargetTypeTimelinePost:
		return &postsspec.QuoteTarget{
			Type:   postsspec.QuoteTargetTimelinePost,
			Owner:  profilespec.ProfileAddress(row.QuoteOwnerAddress.String),
			PostID: postsspec.PostID(row.QuoteTargetID.String),
		}
	case sqlc.VetchiumHubQuoteTargetTypeOpening:
		number, err := strconv.Atoi(row.QuoteTargetID.String)
		if err != nil {
			return nil
		}
		return &postsspec.QuoteTarget{
			Type:          postsspec.QuoteTargetOpening,
			OrgDomain:     orgs.OrgDomain(row.QuoteOwnerAddress.String),
			OpeningNumber: openingsspec.OpeningNumber(number),
		}
	}
	return nil
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

// PostRef names one post of one owner.
type PostRef struct {
	Owner  pgtype.UUID
	PostID postsspec.PostID
}

// Batch is what Posts read: the live posts found, and the owners this tenant
// homes as active users.
type Batch struct {
	Found map[PostRef]postsspec.Post
	Homed map[pgtype.UUID]bool
}

// Posts reads the live posts of many owners in one pass: one read for the
// posts and one for the owner cards (PST-QTE-009). A post of another owner
// with the same ID is not a match.
func (r Reader) Posts(ctx context.Context, refs []PostRef) (Batch, error) {
	batch := Batch{
		Found: map[PostRef]postsspec.Post{}, Homed: map[pgtype.UUID]bool{},
	}
	if len(refs) == 0 {
		return batch, nil
	}
	owners := []pgtype.UUID{}
	seen := map[pgtype.UUID]bool{}
	ids := make([]string, len(refs))
	wanted := map[PostRef]bool{}
	for index, ref := range refs {
		ids[index] = string(ref.PostID)
		wanted[ref] = true
		if !seen[ref.Owner] {
			seen[ref.Owner] = true
			owners = append(owners, ref.Owner)
		}
	}
	cardRows, err := r.Queries.GetHubCardsByDIDs(ctx, owners)
	if err != nil {
		return Batch{}, err
	}
	cards := map[pgtype.UUID]profilespec.ProfileCard{}
	for _, row := range cardRows {
		card, err := r.card(ctx, cardRow{
			row.Handle, row.ProfileAlias, row.DisplayName, row.PictureObjectID,
		})
		if err != nil {
			return Batch{}, err
		}
		cards[row.HubUserDid] = card
		batch.Homed[row.HubUserDid] = true
	}
	rows, err := r.Queries.GetHubLivePostsByIDs(ctx, ids)
	if err != nil {
		return Batch{}, err
	}
	for _, row := range rows {
		ref := PostRef{Owner: row.AuthorHubUserDid, PostID: postsspec.PostID(row.PostID)}
		card, homed := cards[row.AuthorHubUserDid]
		if !wanted[ref] || !homed {
			continue
		}
		batch.Found[ref] = post(card, sqlc.GetHubPostsByIDsRow{
			PostID: row.PostID, Kind: row.Kind, Body: row.Body,
			ReplyPolicy: row.ReplyPolicy, QuotePolicy: row.QuotePolicy,
			LockedAt: row.LockedAt, ReplyCount: row.ReplyCount,
			QuoteCount: row.QuoteCount, Revision: row.Revision,
			Version: row.Version, CreatedAt: row.CreatedAt,
			EditedAt: row.EditedAt, QuoteTargetType: row.QuoteTargetType,
			QuoteOwnerPrincipalType: row.QuoteOwnerPrincipalType,
			QuoteOwnerDid:           row.QuoteOwnerDid,
			QuoteOwnerAddress:       row.QuoteOwnerAddress,
			QuoteOwnerTenantID:      row.QuoteOwnerTenantID,
			QuoteTargetID:           row.QuoteTargetID,
		})
	}
	return batch, nil
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
