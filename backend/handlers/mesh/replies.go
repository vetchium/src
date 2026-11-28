package mesh

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	postsspec "github.com/vetchium/src/typespec/hub/posts"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/dbvalue"
	"backend/internal/meshapi"
	"backend/internal/postread"
	"backend/internal/postsclient"
)

// postRead describes one read of a reply that goes to the home tenant of its
// subject: the post owner, or the author for the Replies tab. The relay
// verifies the viewer for the local hub-api and the peer handler verifies
// that the calling tenant homes the viewer (PST-RD-003).
type postRead[Req, Resp any] struct {
	viewer func(Req) (hubspec.HubUserDID, hubspec.HubHandle)
	// subject is the user whose home tenant answers.
	subject func(Req) hubspec.HubUserDID
	// serve answers for a subject this tenant homes. It returns the problem
	// to write, or an error that is not a declared problem.
	serve func(context.Context, *meshapi.Server, Req) (*Resp, problem.Body, error)
	peer  func(
		context.Context, *meshapi.Server, directoryspec.TenantID, Req,
	) (postsclient.Outcome[Resp], error)
}

// passed lists the declared problems a peer's answer keeps for the relay.
var passed = map[string]problem.Body{
	problem.InvalidPaginationKeyError.Type: problem.InvalidPaginationKeyError,
	hubproblem.ProfileNotFoundError.Type:   hubproblem.ProfileNotFoundError,
	hubproblem.HubPostNotFoundError.Type:   hubproblem.HubPostNotFoundError,
	hubproblem.HubReplyNotFoundError.Type:  hubproblem.HubReplyNotFoundError,

	hubproblem.HubPostQuoteRefusedError.Type: hubproblem.HubPostQuoteRefusedError,
}

func writeServed[Resp any](
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	value *Resp, details problem.Body, err error,
) {
	switch {
	case err != nil:
		s.InternalError(r.Context(), w, "serve post read", err)
	case details != nil:
		s.Problem(r.Context(), w, details)
	default:
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, value)
	}
}

func relayPostRead[Req, Resp any, P interface {
	*Req
	apiserver.Request
}](s *meshapi.Server, read postRead[Req, Resp]) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
		var request Req
		if !apiserver.Decode(s, w, r, P(&request)) {
			return
		}
		did, handle := read.viewer(request)
		if !relayViewer(s, w, r, did, handle) {
			return
		}
		home, ok := ownerHome(s, w, r, read.subject(request))
		if !ok {
			return
		}
		if string(home) == s.TenantID {
			value, details, err := read.serve(r.Context(), s, request)
			writeServed(s, w, r, value, details, err)
			return
		}
		outcome, err := read.peer(r.Context(), s, home, request)
		if err != nil {
			s.Problem(r.Context(), w, hubproblem.ProfileUnavailableError)
			return
		}
		if outcome.Problem != nil {
			if known, ok := passed[outcome.Problem.Type]; ok {
				s.Problem(r.Context(), w, known)
			} else {
				s.Problem(r.Context(), w, hubproblem.ProfileUnavailableError)
			}
			return
		}
		writeServed(s, w, r, outcome.Value, nil, nil)
	}
}

func peerPostRead[Req, Resp any, P interface {
	*Req
	apiserver.Request
}](s *meshapi.Server, read postRead[Req, Resp]) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request Req
		if !apiserver.Decode(s, w, r, P(&request)) {
			return
		}
		did, handle := read.viewer(request)
		if !peerViewer(s, w, r, did, handle) {
			return
		}
		value, details, err := read.serve(r.Context(), s, request)
		writeServed(s, w, r, value, details, err)
	}
}

func parse(did hubspec.HubUserDID) (pgtype.UUID, error) {
	return dbvalue.ParseUUID(string(did))
}

var listReplies = postRead[
	postsspec.MeshListRepliesRequest, postsspec.MeshListRepliesResponse,
]{
	viewer: func(r postsspec.MeshListRepliesRequest) (hubspec.HubUserDID, hubspec.HubHandle) {
		return r.ViewerHubUserDID, r.ViewerHandle
	},
	subject: func(r postsspec.MeshListRepliesRequest) hubspec.HubUserDID {
		return r.OwnerHubUserDID
	},
	serve: func(
		ctx context.Context, s *meshapi.Server,
		request postsspec.MeshListRepliesRequest,
	) (*postsspec.MeshListRepliesResponse, problem.Body, error) {
		owner, err := parse(request.OwnerHubUserDID)
		if err != nil {
			return nil, problem.ValidationFailedError, nil
		}
		viewer, err := parse(request.ViewerHubUserDID)
		if err != nil {
			return nil, problem.ValidationFailedError, nil
		}
		replies, next, err := postReader(s).Thread(
			ctx, owner, string(request.PostID), request.ParentReplyID,
			request.FromReplyID, viewer, request.PaginationKey,
			request.EffectiveLimit(),
		)
		switch {
		case errors.Is(err, postread.ErrInvalidKey):
			return nil, problem.InvalidPaginationKeyError, nil
		case errors.Is(err, postread.ErrPostNotFound):
			return nil, hubproblem.HubPostNotFoundError, nil
		case errors.Is(err, postread.ErrReplyNotFound):
			return nil, hubproblem.HubReplyNotFoundError, nil
		case err != nil:
			return nil, nil, err
		}
		return &postsspec.MeshListRepliesResponse{
			Replies: replies, NextPaginationKey: next,
		}, nil, nil
	},
	peer: func(
		ctx context.Context, s *meshapi.Server, tenant directoryspec.TenantID,
		request postsspec.MeshListRepliesRequest,
	) (postsclient.Outcome[postsspec.MeshListRepliesResponse], error) {
		return s.Posts.PeerListReplies(ctx, tenant, request)
	},
}

var getReply = postRead[
	postsspec.MeshGetReplyRequest, postsspec.MeshGetReplyResponse,
]{
	viewer: func(r postsspec.MeshGetReplyRequest) (hubspec.HubUserDID, hubspec.HubHandle) {
		return r.ViewerHubUserDID, r.ViewerHandle
	},
	subject: func(r postsspec.MeshGetReplyRequest) hubspec.HubUserDID {
		return r.OwnerHubUserDID
	},
	serve: func(
		ctx context.Context, s *meshapi.Server,
		request postsspec.MeshGetReplyRequest,
	) (*postsspec.MeshGetReplyResponse, problem.Body, error) {
		owner, err := parse(request.OwnerHubUserDID)
		if err != nil {
			return nil, problem.ValidationFailedError, nil
		}
		reply, err := postReader(s).Reply(
			ctx, owner, string(request.PostID), string(request.ReplyID))
		switch {
		case errors.Is(err, postread.ErrPostNotFound):
			return nil, hubproblem.HubPostNotFoundError, nil
		case errors.Is(err, postread.ErrReplyNotFound):
			return nil, hubproblem.HubReplyNotFoundError, nil
		case err != nil:
			return nil, nil, err
		}
		return &reply, nil, nil
	},
	peer: func(
		ctx context.Context, s *meshapi.Server, tenant directoryspec.TenantID,
		request postsspec.MeshGetReplyRequest,
	) (postsclient.Outcome[postsspec.MeshGetReplyResponse], error) {
		return s.Posts.PeerGetReply(ctx, tenant, request)
	},
}

var listAuthorReplies = postRead[
	postsspec.MeshListAuthorRepliesRequest,
	postsspec.MeshListAuthorRepliesResponse,
]{
	viewer: func(r postsspec.MeshListAuthorRepliesRequest) (hubspec.HubUserDID, hubspec.HubHandle) {
		return r.ViewerHubUserDID, r.ViewerHandle
	},
	subject: func(r postsspec.MeshListAuthorRepliesRequest) hubspec.HubUserDID {
		return r.AuthorHubUserDID
	},
	serve: func(
		ctx context.Context, s *meshapi.Server,
		request postsspec.MeshListAuthorRepliesRequest,
	) (*postsspec.MeshListAuthorRepliesResponse, problem.Body, error) {
		author, err := parse(request.AuthorHubUserDID)
		if err != nil {
			return nil, problem.ValidationFailedError, nil
		}
		replies, next, err := postReader(s).AuthorReplies(
			ctx, author, request.PaginationKey, request.EffectiveLimit())
		switch {
		case errors.Is(err, postread.ErrInvalidKey):
			return nil, problem.InvalidPaginationKeyError, nil
		case errors.Is(err, pgx.ErrNoRows):
			return nil, hubproblem.ProfileNotFoundError, nil
		case err != nil:
			return nil, nil, err
		}
		return &postsspec.MeshListAuthorRepliesResponse{
			Replies: replies, NextPaginationKey: next,
		}, nil, nil
	},
	peer: func(
		ctx context.Context, s *meshapi.Server, tenant directoryspec.TenantID,
		request postsspec.MeshListAuthorRepliesRequest,
	) (postsclient.Outcome[postsspec.MeshListAuthorRepliesResponse], error) {
		return s.Posts.PeerListAuthorReplies(ctx, tenant, request)
	},
}

// RelayListReplies, RelayGetReply, and RelayListAuthorReplies answer the
// local hub-api. PeerListReplies, PeerGetReply, and PeerListAuthorReplies
// answer another tenant.
func RelayListReplies(s *meshapi.Server) http.HandlerFunc {
	return relayPostRead(s, listReplies)
}

func PeerListReplies(s *meshapi.Server) http.HandlerFunc {
	return peerPostRead(s, listReplies)
}

func RelayGetReply(s *meshapi.Server) http.HandlerFunc {
	return relayPostRead(s, getReply)
}

func PeerGetReply(s *meshapi.Server) http.HandlerFunc {
	return peerPostRead(s, getReply)
}

func RelayListAuthorReplies(s *meshapi.Server) http.HandlerFunc {
	return relayPostRead(s, listAuthorReplies)
}

func PeerListAuthorReplies(s *meshapi.Server) http.HandlerFunc {
	return peerPostRead(s, listAuthorReplies)
}
