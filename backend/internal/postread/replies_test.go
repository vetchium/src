package postread

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	postsspec "github.com/vetchium/src/typespec/hub/posts"

	"backend/internal/db/sqlc"
)

var (
	author = pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	viewer = pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
)

func row(state sqlc.VetchiumHubPostReplyState, childRows int32) sqlc.ListHubPostRepliesRow {
	return sqlc.ListHubPostRepliesRow{
		ReplyID: validID, AuthorHubUserDid: author, AuthorHandle: "alice",
		Body:  pgtype.Text{String: "words", Valid: state != sqlc.VetchiumHubPostReplyStateAuthorRemoved},
		State: state, Revision: 3, ChildCount: 1, ChildRowCount: childRows,
		CreatedAt: pgtype.Timestamptz{Time: time.Unix(1, 0), Valid: true},
	}
}

func TestShapeReply(t *testing.T) {
	t.Parallel()
	live := sqlc.VetchiumHubPostReplyStateLive
	hidden := sqlc.VetchiumHubPostReplyStateHiddenByOwner
	removed := sqlc.VetchiumHubPostReplyStateAuthorRemoved
	for name, tc := range map[string]struct {
		row    sqlc.ListHubPostRepliesRow
		viewer pgtype.UUID
		shown  bool
		state  postsspec.ThreadReplyState
		body   bool
	}{
		"live":                          {row(live, 0), viewer, true, postsspec.ThreadReplyLive, true},
		"hidden shows words to author":  {row(hidden, 0), author, true, postsspec.ThreadReplyHidden, true},
		"hidden to others, no children": {row(hidden, 0), viewer, false, "", false},
		"hidden to others, children":    {row(hidden, 2), viewer, true, postsspec.ThreadReplyPlaceholder, false},
		"removed, no children":          {row(removed, 0), viewer, false, "", false},
		"removed, children":             {row(removed, 1), author, true, postsspec.ThreadReplyPlaceholder, false},
	} {
		got, ok := ShapeReply(validID, tc.viewer, tc.row)
		if ok != tc.shown {
			t.Errorf("%s: shown = %v", name, ok)
			continue
		}
		if !ok {
			continue
		}
		if got.State != tc.state || (got.Body != nil) != tc.body {
			t.Errorf("%s: state %q body %v", name, got.State, got.Body)
		}
		if got.State == postsspec.ThreadReplyPlaceholder &&
			(got.Edited || got.Revision != 1) {
			t.Errorf("%s: placeholder keeps edit state", name)
		}
		if got.ChildCount != 1 || got.AuthorHubUserDID == "" {
			t.Errorf("%s: %+v", name, got)
		}
	}
}

func TestAuthorReplyHoldsNoWordsAfterPostRemoval(t *testing.T) {
	t.Parallel()
	item := authorReply(sqlc.ListHubReplyTextsByAuthorRow{
		ReplyID: validID, PostID: validID, PostOwnerHandle: "bob",
		State: sqlc.VetchiumHubReplyTextStatePostRemoved,
		Body:  pgtype.Text{String: "words", Valid: true}, Revision: 1,
		CreatedAt: pgtype.Timestamptz{Time: time.Unix(1, 0), Valid: true},
	})
	if item.State != postsspec.AuthorReplyPostRemoved || item.Body != "" {
		t.Fatalf("item = %+v", item)
	}
}
