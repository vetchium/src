package posts

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	postsspec "github.com/vetchium/src/typespec/hub/posts"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/db/sqlc"
	hubruntime "backend/internal/hub"
)

func stored(t *testing.T, details problem.Details) []byte {
	t.Helper()
	body, err := json.Marshal(details)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestRejectionKeepsDeclaredProblems(t *testing.T) {
	t.Parallel()
	for _, want := range []problem.Details{
		hubproblem.HubPostNotFoundError, hubproblem.HubPostRepliesClosedError,
		hubproblem.HubPostReplyRefusedError, hubproblem.HubReplyNotFoundError,
		hubproblem.HubPostLimitReachedError,
	} {
		got := rejection(stored(t, want))
		if got.(problem.Details).Type != want.Type {
			t.Errorf("rejection(%s) = %v", want.Type, got)
		}
	}
	invalid := problem.ValidationFailedError
	invalid.Fields = []string{"parent_reply_id"}
	got := rejection(stored(t, invalid)).(problem.Details)
	if got.Type != problem.ValidationFailedError.Type ||
		len(got.Fields) != 1 || got.Fields[0] != "parent_reply_id" {
		t.Errorf("validation problem = %+v", got)
	}
}

func TestRejectionHidesUndeclaredProblems(t *testing.T) {
	t.Parallel()
	for name, body := range map[string][]byte{
		"initiator mismatch": stored(t, problem.InternalServerError),
		"not a problem":      []byte("{"),
	} {
		got := rejection(body).(problem.Details)
		if got.Type != hubproblem.HubPostUnavailableError.Type {
			t.Errorf("%s: rejection = %+v", name, got)
		}
	}
}

func TestEditReplyProblemOrder(t *testing.T) {
	t.Parallel()
	live := sqlc.GetHubReplyTextRow{
		State: sqlc.VetchiumHubReplyTextStateLive, WindowOpen: true, Revision: 2,
	}
	removed := live
	removed.State = sqlc.VetchiumHubReplyTextStateRemoved
	closed := live
	closed.WindowOpen = false
	for name, tc := range map[string]struct {
		row      sqlc.GetHubReplyTextRow
		revision int32
		want     problem.Details
	}{
		"not live wins":     {removed, 1, hubproblem.HubReplyNotFoundError},
		"window before rev": {closed, 1, hubproblem.HubPostEditClosedError},
		"stale revision":    {live, 1, hubproblem.HubPostConflictError},
		"concurrent edit":   {live, 2, hubproblem.HubPostConflictError},
	} {
		got := editReplyProblem(tc.row, tc.revision).(problem.Details)
		if got.Type != tc.want.Type {
			t.Errorf("%s: %s, want %s", name, got.Type, tc.want.Type)
		}
	}
}

func TestCountDeltas(t *testing.T) {
	t.Parallel()
	live := sqlc.VetchiumHubPostReplyStateLive
	hidden := sqlc.VetchiumHubPostReplyStateHiddenByOwner
	for name, tc := range map[string]struct {
		from, to     sqlc.VetchiumHubPostReplyState
		sub          bool
		reply, child int32
	}{
		"hide top-level":   {live, hidden, false, -1, 0},
		"hide sub-reply":   {live, hidden, true, -1, -1},
		"unhide sub-reply": {hidden, live, true, 1, 1},
		"repeat":           {hidden, hidden, true, 0, 0},
	} {
		reply, child := countDeltas(tc.from, tc.to, tc.sub)
		if reply != tc.reply || child != tc.child {
			t.Errorf("%s: (%d, %d), want (%d, %d)",
				name, reply, child, tc.reply, tc.child)
		}
	}
}

func meshReply(did string, handle string) postsspec.MeshReply {
	return postsspec.MeshReply{
		Reply:            postsspec.Reply{AuthorHandle: hubspec.HubHandle(handle)},
		AuthorHubUserDID: hubspec.HubUserDID(did),
	}
}

func TestDropMutedKeepsOrderAndStripsDID(t *testing.T) {
	t.Parallel()
	replies := []postsspec.MeshReply{
		meshReply("a", "alice"), meshReply("b", "bob"), meshReply("a", "alice"),
		meshReply("c", "carol"),
	}
	kept := dropMuted(replies, map[hubspec.HubUserDID]bool{"b": true})
	if len(kept) != 3 || kept[0].AuthorHandle != "alice" ||
		kept[1].AuthorHandle != "alice" || kept[2].AuthorHandle != "carol" {
		t.Fatalf("kept = %+v", kept)
	}
	if len(dropMuted(nil, nil)) != 0 {
		t.Fatal("empty page must stay empty")
	}
}

func TestParentRefusal(t *testing.T) {
	t.Parallel()
	const owner, replier, other = hubspec.HubUserDID("o"), hubspec.HubUserDID("r"),
		hubspec.HubUserDID("x")
	parent := func(author hubspec.HubUserDID, state postsspec.ThreadReplyState,
		grandparent *postsspec.PostID,
	) postsspec.MeshGetReplyResponse {
		return postsspec.MeshGetReplyResponse{
			AuthorHubUserDID: author, AuthorTenantID: "usa1", State: state,
			ParentReplyID: grandparent,
		}
	}
	never := func(hubspec.HubUserDID, directoryspec.TenantID) (bool, error) {
		t.Error("a block check ran for the owner or the replier")
		return false, nil
	}
	grandparent := postsspec.PostID("g")
	for name, tc := range map[string]struct {
		parent  postsspec.MeshGetReplyResponse
		blocked func(hubspec.HubUserDID, directoryspec.TenantID) (bool, error)
		want    *problem.Details
	}{
		"owner's reply skips check": {parent(owner, postsspec.ThreadReplyLive, nil), never, nil},
		"own reply skips check":     {parent(replier, postsspec.ThreadReplyLive, nil), never, nil},
		"hidden parent":             {parent(other, postsspec.ThreadReplyHidden, nil), never, &hubproblem.HubReplyNotFoundError},
		"placeholder parent":        {parent(other, postsspec.ThreadReplyPlaceholder, nil), never, &hubproblem.HubReplyNotFoundError},
		"reply to a sub-reply": {
			parent(other, postsspec.ThreadReplyLive, &grandparent), never,
			&problem.ValidationFailedError,
		},
		"blocked": {
			parent(other, postsspec.ThreadReplyLive, nil),
			func(hubspec.HubUserDID, directoryspec.TenantID) (bool, error) { return true, nil },
			&hubproblem.HubPostReplyRefusedError,
		},
		"not blocked": {
			parent(other, postsspec.ThreadReplyLive, nil),
			func(hubspec.HubUserDID, directoryspec.TenantID) (bool, error) { return false, nil },
			nil,
		},
		"region down fails closed": {
			parent(other, postsspec.ThreadReplyLive, nil),
			func(hubspec.HubUserDID, directoryspec.TenantID) (bool, error) {
				return false, errors.New("unavailable")
			},
			&hubproblem.HubPostUnavailableError,
		},
	} {
		got, err := parentRefusal(tc.parent, owner, replier, tc.blocked)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		switch {
		case tc.want == nil && got != nil:
			t.Errorf("%s: refused with %v", name, got)
		case tc.want != nil && (got == nil || got.(problem.Details).Type != tc.want.Type):
			t.Errorf("%s: got %v, want %s", name, got, tc.want.Type)
		}
	}
}

func TestReplyKeysBindThreadAndTab(t *testing.T) {
	t.Parallel()
	s := &hubruntime.Server{CredentialKey: [32]byte{1}}
	owner := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	parent := postsspec.PostID("p")
	top := threadScope(owner, "post", nil)
	sub := threadScope(owner, "post", &parent)
	signed, err := signKey(s, repliesPurpose, top, "inner")
	if err != nil {
		t.Fatal(err)
	}
	if inner, ok := verifyKey(s, repliesPurpose, top, signed); !ok || inner != "inner" {
		t.Fatalf("verify = %q, %v", inner, ok)
	}
	if _, ok := verifyKey(s, repliesPurpose, sub, signed); ok {
		t.Fatal("a top-level key paged the sub-replies")
	}
	if _, ok := verifyKey(s, repliesPurpose, threadScope(owner, "other", nil), signed); ok {
		t.Fatal("a key paged another post")
	}
	if _, ok := verifyKey(s, authorRepliesPurpose, top, signed); ok {
		t.Fatal("a thread key paged the Replies tab")
	}
	if _, ok := verifyListKey(s, owner, signed); ok {
		t.Fatal("a thread key paged the posts list")
	}
}
