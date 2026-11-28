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

var (
	// ErrPostNotFound reports a post that is not live, is not this owner's,
	// or whose owner this tenant does not home.
	ErrPostNotFound = errors.New("post not found")
	// ErrReplyNotFound reports a reply that is not in the post.
	ErrReplyNotFound = errors.New("reply not found")
)

// ShapeReply shapes one structure row for one viewer (PST-THR-003,
// PST-THR-004). ok is false when the page leaves the row out.
func ShapeReply(
	postID string, viewer pgtype.UUID, row sqlc.ListHubPostRepliesRow,
) (postsspec.MeshReply, bool) {
	reply := postsspec.Reply{
		ReplyID:      postsspec.PostID(row.ReplyID),
		PostID:       postsspec.PostID(postID),
		AuthorHandle: hubspec.HubHandle(row.AuthorHandle),
		ChildCount:   row.ChildCount,
		Revision:     row.Revision,
		Edited:       row.Revision > 1,
		CreatedAt:    row.CreatedAt.Time.UTC(),
	}
	if row.ParentReplyID.Valid {
		parent := postsspec.PostID(row.ParentReplyID.String)
		reply.ParentReplyID = &parent
	}
	switch {
	case row.State == sqlc.VetchiumHubPostReplyStateLive && row.Body.Valid:
		reply.State = postsspec.ThreadReplyLive
	case row.State == sqlc.VetchiumHubPostReplyStateHiddenByOwner &&
		row.Body.Valid && row.AuthorHubUserDid == viewer:
		reply.State = postsspec.ThreadReplyHidden
	case row.ChildRowCount > 0:
		// A placeholder holds no words, so it holds no edit state either.
		reply.State = postsspec.ThreadReplyPlaceholder
		reply.Revision, reply.Edited = 1, false
		return postsspec.MeshReply{
			Reply:            reply,
			AuthorHubUserDID: hubspec.HubUserDID(dbvalue.FormatUUID(row.AuthorHubUserDid)),
		}, true
	default:
		return postsspec.MeshReply{}, false
	}
	body := row.Body.String
	reply.Body = &body
	return postsspec.MeshReply{
		Reply:            reply,
		AuthorHubUserDID: hubspec.HubUserDID(dbvalue.FormatUUID(row.AuthorHubUserDid)),
	}, true
}

// livePost holds the answer to the question: is this a live post of this
// owner in this tenant?
func (r Reader) livePost(
	ctx context.Context, owner pgtype.UUID, postID string,
) error {
	rows, err := r.Queries.GetHubPostsByIDs(ctx, sqlc.GetHubPostsByIDsParams{
		AuthorHubUserDid: owner, PostIds: []string{postID},
	})
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return ErrPostNotFound
	}
	return nil
}

// Thread reads one page of replies of a live post of an owner this tenant
// homes, oldest first (PST-THR-002). A row the viewer may not see is left
// out, so a page can be short; the next key follows the last row read.
func (r Reader) Thread(
	ctx context.Context, owner pgtype.UUID, postID string,
	parent *postsspec.PostID, viewer pgtype.UUID,
	key *common.PaginationKey, limit int32,
) ([]postsspec.MeshReply, *common.PaginationKey, error) {
	params := sqlc.ListHubPostRepliesParams{PostID: postID, PageLimit: limit + 1}
	if parent != nil {
		params.ParentReplyID = pgtype.Text{String: string(*parent), Valid: true}
	}
	if key != nil {
		c, err := decodeKey(*key)
		if err != nil {
			return nil, nil, err
		}
		params.AfterCreatedAt = pgtype.Timestamptz{Time: c.At, Valid: true}
		params.AfterReplyID = pgtype.Text{String: c.PostID, Valid: true}
	}
	if err := r.livePost(ctx, owner, postID); err != nil {
		return nil, nil, err
	}
	rows, err := r.Queries.ListHubPostReplies(ctx, params)
	if err != nil {
		return nil, nil, err
	}
	replies := []postsspec.MeshReply{}
	var next *common.PaginationKey
	for index, row := range rows {
		if index == int(limit) {
			last := rows[index-1]
			encoded, err := encodeKey(cursor{
				At: last.CreatedAt.Time.UTC(), PostID: last.ReplyID,
			})
			if err != nil {
				return nil, nil, err
			}
			next = &encoded
			break
		}
		if reply, ok := ShapeReply(postID, viewer, row); ok {
			replies = append(replies, reply)
		}
	}
	return replies, next, nil
}

func threadState(state sqlc.VetchiumHubPostReplyState) postsspec.ThreadReplyState {
	switch state {
	case sqlc.VetchiumHubPostReplyStateLive:
		return postsspec.ThreadReplyLive
	case sqlc.VetchiumHubPostReplyStateHiddenByOwner:
		return postsspec.ThreadReplyHidden
	default:
		return postsspec.ThreadReplyPlaceholder
	}
}

// Reply reads who wrote one reply of a live post of an owner this tenant
// homes (PST-RPL-004). It holds no words.
func (r Reader) Reply(
	ctx context.Context, owner pgtype.UUID, postID, replyID string,
) (postsspec.MeshGetReplyResponse, error) {
	if err := r.livePost(ctx, owner, postID); err != nil {
		return postsspec.MeshGetReplyResponse{}, err
	}
	row, err := r.Queries.GetHubPostReply(ctx, sqlc.GetHubPostReplyParams{
		PostID: postID, ReplyID: replyID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return postsspec.MeshGetReplyResponse{}, ErrReplyNotFound
	}
	if err != nil {
		return postsspec.MeshGetReplyResponse{}, err
	}
	response := postsspec.MeshGetReplyResponse{
		ReplyID: postsspec.PostID(row.ReplyID), PostID: postsspec.PostID(postID),
		AuthorHubUserDID: hubspec.HubUserDID(dbvalue.FormatUUID(row.AuthorHubUserDid)),
		AuthorTenantID:   directoryspec.TenantID(row.AuthorTenantID),
		AuthorHandle:     hubspec.HubHandle(row.AuthorHandle),
		State:            threadState(row.State),
	}
	if row.ParentReplyID.Valid {
		parent := postsspec.PostID(row.ParentReplyID.String)
		response.ParentReplyID = &parent
	}
	return response, nil
}

// AuthorReplies reads one page of the replies of an author this tenant
// homes, newest first (PST-TAB-001). It returns pgx.ErrNoRows when the
// tenant does not home the author. A removed post leaves the item without
// words (PST-TAB-003).
func (r Reader) AuthorReplies(
	ctx context.Context, author pgtype.UUID, key *common.PaginationKey,
	limit int32,
) ([]postsspec.AuthorReply, *common.PaginationKey, error) {
	params := sqlc.ListHubReplyTextsByAuthorParams{
		AuthorHubUserDid: author, PageLimit: limit + 1,
	}
	if key != nil {
		c, err := decodeKey(*key)
		if err != nil {
			return nil, nil, err
		}
		params.BeforeCreatedAt = pgtype.Timestamptz{Time: c.At, Valid: true}
		params.BeforeReplyID = pgtype.Text{String: c.PostID, Valid: true}
	}
	if _, err := r.Queries.GetHubCardByDID(ctx, author); err != nil {
		return nil, nil, err
	}
	rows, err := r.Queries.ListHubReplyTextsByAuthor(ctx, params)
	if err != nil {
		return nil, nil, err
	}
	replies := []postsspec.AuthorReply{}
	var next *common.PaginationKey
	for index, row := range rows {
		if index == int(limit) {
			last := rows[index-1]
			encoded, err := encodeKey(cursor{
				At: last.CreatedAt.Time.UTC(), PostID: last.ReplyID,
			})
			if err != nil {
				return nil, nil, err
			}
			next = &encoded
			break
		}
		replies = append(replies, authorReply(row))
	}
	return replies, next, nil
}

func authorReply(row sqlc.ListHubReplyTextsByAuthorRow) postsspec.AuthorReply {
	item := postsspec.AuthorReply{
		ReplyID: postsspec.PostID(row.ReplyID), PostID: postsspec.PostID(row.PostID),
		PostOwnerHandle: hubspec.HubHandle(row.PostOwnerHandle),
		State:           postsspec.AuthorReplyPostRemoved,
		Edited:          row.Revision > 1,
		CreatedAt:       row.CreatedAt.Time.UTC(),
	}
	if row.State == sqlc.VetchiumHubReplyTextStateLive {
		item.State = postsspec.AuthorReplyLive
		item.Body = row.Body.String
	}
	return item
}
