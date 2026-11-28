package postsclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	hubspec "github.com/vetchium/src/typespec/hub"
	postsspec "github.com/vetchium/src/typespec/hub/posts"
	"github.com/vetchium/src/typespec/problem"
)

const (
	did = "01987aef-1234-7abc-8abc-123456789abc"
	id  = "0123456789abcdefghij0123456789abcdefghij"

	handle = "abcd1234-abcdefghjkm"
)

func serve(t *testing.T, status int, mediaType string, body any) *Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer secret" {
				t.Errorf("Authorization = %q", r.Header.Get("Authorization"))
			}
			w.Header().Set("Content-Type", mediaType)
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(body)
		}))
	t.Cleanup(server.Close)
	return NewRelay(server.URL, "secret", time.Second)
}

func getMany() postsspec.MeshGetManyPostsRequest {
	return postsspec.MeshGetManyPostsRequest{
		ViewerHubUserDID: hubspec.HubUserDID(did), ViewerHandle: "viewer",
		Posts: []postsspec.MeshPostReference{{
			OwnerHubUserDID: hubspec.HubUserDID(did),
			PostID:          postsspec.PostID(id),
		}},
	}
}

func TestGetManyAcceptsMatchingResults(t *testing.T) {
	t.Parallel()
	client := serve(t, 200, "application/json", postsspec.MeshGetManyPostsResponse{
		Results: []postsspec.MeshPostResult{{
			Status:          postsspec.MeshPostNotFound,
			OwnerHubUserDID: hubspec.HubUserDID(did),
			PostID:          postsspec.PostID(id),
		}},
	})
	outcome, err := client.GetMany(context.Background(), getMany())
	if err != nil || outcome.Results == nil || len(outcome.Results.Results) != 1 {
		t.Fatalf("GetMany = %+v, %v", outcome, err)
	}
}

func TestGetManyRefusesFoundWithoutPost(t *testing.T) {
	t.Parallel()
	client := serve(t, 200, "application/json", postsspec.MeshGetManyPostsResponse{
		Results: []postsspec.MeshPostResult{{
			Status:          postsspec.MeshPostFound,
			OwnerHubUserDID: hubspec.HubUserDID(did),
			PostID:          postsspec.PostID(id),
		}},
	})
	if _, err := client.GetMany(context.Background(), getMany()); err == nil {
		t.Fatal("GetMany accepted a found result without a post")
	}
}

func TestGetManyRefusesResultsForOtherReferences(t *testing.T) {
	t.Parallel()
	client := serve(t, 200, "application/json", postsspec.MeshGetManyPostsResponse{
		Results: []postsspec.MeshPostResult{},
	})
	if _, err := client.GetMany(context.Background(), getMany()); err == nil {
		t.Fatal("GetMany accepted a short result list")
	}
}

func TestListReturnsDeclaredProblem(t *testing.T) {
	t.Parallel()
	client := serve(t, 400, problem.MediaType, problem.InvalidPaginationKeyError)
	outcome, err := client.List(context.Background(), postsspec.MeshListPostsRequest{})
	if err != nil || outcome.Problem == nil ||
		outcome.Problem.Type != problem.InvalidPaginationKeyError.Type {
		t.Fatalf("List = %+v, %v", outcome, err)
	}
}

func TestListRefusesMissingPostsArray(t *testing.T) {
	t.Parallel()
	client := serve(t, 200, "application/json", map[string]any{})
	if _, err := client.List(context.Background(), postsspec.MeshListPostsRequest{}); err == nil {
		t.Fatal("List accepted a response without posts")
	}
}

func TestListRepliesRefusesAnswerForAnotherThread(t *testing.T) {
	t.Parallel()
	body := "words"
	request := postsspec.MeshListRepliesRequest{
		OwnerHubUserDID: hubspec.HubUserDID(did), PostID: id,
		ViewerHubUserDID: hubspec.HubUserDID(did), ViewerHandle: handle,
	}
	reply := func(post postsspec.PostID, state postsspec.ThreadReplyState,
		text *string,
	) postsspec.MeshListRepliesResponse {
		return postsspec.MeshListRepliesResponse{Replies: []postsspec.MeshReply{{
			Reply: postsspec.Reply{
				ReplyID: id, PostID: post, AuthorHandle: handle,
				State: state, Body: text,
			},
			AuthorHubUserDID: hubspec.HubUserDID(did),
		}}}
	}
	good := serve(t, http.StatusOK, "application/json",
		reply(id, postsspec.ThreadReplyLive, &body))
	if outcome, err := good.ListReplies(context.Background(), request); err != nil ||
		len(outcome.Value.Replies) != 1 {
		t.Fatalf("good answer = %+v, %v", outcome, err)
	}
	for name, answer := range map[string]postsspec.MeshListRepliesResponse{
		"other post":           reply("abcdefghij0123456789abcdefghij0123456789", postsspec.ThreadReplyLive, &body),
		"placeholder has body": reply(id, postsspec.ThreadReplyPlaceholder, &body),
		"live has no body":     reply(id, postsspec.ThreadReplyLive, nil),
	} {
		client := serve(t, http.StatusOK, "application/json", answer)
		if _, err := client.ListReplies(context.Background(), request); err == nil {
			t.Errorf("%s: answer was accepted", name)
		}
	}
}

func embedsRequest() postsspec.MeshReadEmbedsRequest {
	return postsspec.MeshReadEmbedsRequest{
		ViewerHubUserDID: hubspec.HubUserDID(did), ViewerHandle: "viewer",
		Items: []postsspec.MeshEmbedReference{{
			OwnerHubUserDID: hubspec.HubUserDID(did), TargetPostID: postsspec.PostID(id),
			QuotePostID: postsspec.PostID(id), QuoterHubUserDID: hubspec.HubUserDID(did),
		}},
	}
}

func TestReadEmbedsAcceptsMatchingResults(t *testing.T) {
	t.Parallel()
	client := serve(t, 200, "application/json", postsspec.MeshReadEmbedsResponse{
		Results: []postsspec.MeshEmbedResult{{
			Status:       postsspec.MeshEmbedUnavailable,
			TargetPostID: postsspec.PostID(id), QuotePostID: postsspec.PostID(id),
		}},
	})
	outcome, err := client.ReadEmbeds(context.Background(), embedsRequest())
	if err != nil || outcome.Value == nil || len(outcome.Value.Results) != 1 {
		t.Fatalf("ReadEmbeds = %+v, %v", outcome, err)
	}
}

func TestReadEmbedsRefusesAPostForAnotherOwner(t *testing.T) {
	t.Parallel()
	other := hubspec.HubUserDID("0194f3a0-0000-7000-8000-000000000009")
	client := serve(t, 200, "application/json", postsspec.MeshReadEmbedsResponse{
		Results: []postsspec.MeshEmbedResult{{
			Status:       postsspec.MeshEmbedPost,
			TargetPostID: postsspec.PostID(id), QuotePostID: postsspec.PostID(id),
			Post: &postsspec.MeshPost{
				Post:            postsspec.Post{PostID: postsspec.PostID(id)},
				OwnerHubUserDID: other,
			},
		}},
	})
	if _, err := client.ReadEmbeds(context.Background(), embedsRequest()); err == nil {
		t.Fatal("ReadEmbeds accepted a post of another owner")
	}
}

func TestReadEmbedsRefusesAShortResultList(t *testing.T) {
	t.Parallel()
	client := serve(t, 200, "application/json", postsspec.MeshReadEmbedsResponse{
		Results: []postsspec.MeshEmbedResult{},
	})
	if _, err := client.ReadEmbeds(context.Background(), embedsRequest()); err == nil {
		t.Fatal("ReadEmbeds accepted a short result list")
	}
}
