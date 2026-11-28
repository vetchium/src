package mesh

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	postsspec "github.com/vetchium/src/typespec/hub/posts"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/fanout"
	"backend/internal/meshapi"
	"backend/internal/postread"
	"backend/internal/postsclient"
)

var readQuoteTarget = postRead[
	postsspec.MeshReadQuoteTargetRequest, postsspec.MeshPost,
]{
	viewer: func(r postsspec.MeshReadQuoteTargetRequest) (hubspec.HubUserDID, hubspec.HubHandle) {
		return r.ViewerHubUserDID, r.ViewerHandle
	},
	subject: func(r postsspec.MeshReadQuoteTargetRequest) hubspec.HubUserDID {
		return r.OwnerHubUserDID
	},
	serve: func(
		ctx context.Context, s *meshapi.Server,
		request postsspec.MeshReadQuoteTargetRequest,
	) (*postsspec.MeshPost, problem.Body, error) {
		owner, err := parse(request.OwnerHubUserDID)
		if err != nil {
			return nil, problem.ValidationFailedError, nil
		}
		viewer, err := parse(request.ViewerHubUserDID)
		if err != nil {
			return nil, problem.ValidationFailedError, nil
		}
		post, err := postReader(s).QuoteTarget(
			ctx, owner, string(request.TargetPostID), viewer)
		switch {
		case errors.Is(err, postread.ErrPostNotFound),
			errors.Is(err, pgx.ErrNoRows):
			return nil, hubproblem.HubPostNotFoundError, nil
		case errors.Is(err, postread.ErrQuoteRefused):
			return nil, hubproblem.HubPostQuoteRefusedError, nil
		case err != nil:
			return nil, nil, err
		}
		return &postsspec.MeshPost{
			Post: post, OwnerHubUserDID: request.OwnerHubUserDID,
		}, nil, nil
	},
	peer: func(
		ctx context.Context, s *meshapi.Server, tenant directoryspec.TenantID,
		request postsspec.MeshReadQuoteTargetRequest,
	) (postsclient.Outcome[postsspec.MeshPost], error) {
		return s.Posts.PeerReadQuoteTarget(ctx, tenant, request)
	},
}

var listQuotes = postRead[
	postsspec.MeshListQuotesRequest, postsspec.MeshListQuotesResponse,
]{
	viewer: func(r postsspec.MeshListQuotesRequest) (hubspec.HubUserDID, hubspec.HubHandle) {
		return r.ViewerHubUserDID, r.ViewerHandle
	},
	subject: func(r postsspec.MeshListQuotesRequest) hubspec.HubUserDID {
		return r.OwnerHubUserDID
	},
	serve: func(
		ctx context.Context, s *meshapi.Server,
		request postsspec.MeshListQuotesRequest,
	) (*postsspec.MeshListQuotesResponse, problem.Body, error) {
		owner, err := parse(request.OwnerHubUserDID)
		if err != nil {
			return nil, problem.ValidationFailedError, nil
		}
		quotes, next, err := postReader(s).Quotes(
			ctx, owner, string(request.PostID), request.PaginationKey,
			request.EffectiveLimit())
		switch {
		case errors.Is(err, postread.ErrInvalidKey):
			return nil, problem.InvalidPaginationKeyError, nil
		case errors.Is(err, postread.ErrPostNotFound):
			return nil, hubproblem.HubPostNotFoundError, nil
		case err != nil:
			return nil, nil, err
		}
		return &postsspec.MeshListQuotesResponse{
			Quotes: quotes, NextPaginationKey: next,
		}, nil, nil
	},
	peer: func(
		ctx context.Context, s *meshapi.Server, tenant directoryspec.TenantID,
		request postsspec.MeshListQuotesRequest,
	) (postsclient.Outcome[postsspec.MeshListQuotesResponse], error) {
		return s.Posts.PeerListQuotes(ctx, tenant, request)
	},
}

// RelayReadQuoteTarget, RelayListQuotes, and RelayReadEmbeds answer the local
// hub-api. The Peer handlers answer another tenant.
func RelayReadQuoteTarget(s *meshapi.Server) http.HandlerFunc {
	return relayPostRead(s, readQuoteTarget)
}

func PeerReadQuoteTarget(s *meshapi.Server) http.HandlerFunc {
	return peerPostRead(s, readQuoteTarget)
}

func RelayListQuotes(s *meshapi.Server) http.HandlerFunc {
	return relayPostRead(s, listQuotes)
}

func PeerListQuotes(s *meshapi.Server) http.HandlerFunc {
	return peerPostRead(s, listQuotes)
}

func writeEmbeds(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	results []postsspec.MeshEmbedResult,
) {
	w.Header().Set("Cache-Control", "no-store")
	s.JSON(r.Context(), w, http.StatusOK,
		postsspec.MeshReadEmbedsResponse{Results: results})
}

func unavailableEmbed(item postsspec.MeshEmbedReference) postsspec.MeshEmbedResult {
	return postsspec.MeshEmbedResult{
		Status:       postsspec.MeshEmbedUnavailable,
		TargetPostID: item.TargetPostID, QuotePostID: item.QuotePostID,
	}
}

// RelayReadEmbeds answers a local hub-api that reads embed targets. It groups
// the items by the home tenant of each owner and reads each remote tenant in
// parallel (PST-RD-001). An owner or a region that does not answer makes only
// its own items `unavailable`, so the page keeps its other embeds.
func RelayReadEmbeds(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
		var request postsspec.MeshReadEmbedsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		if !relayViewer(s, w, r, request.ViewerHubUserDID, request.ViewerHandle) {
			return
		}
		results := make([]postsspec.MeshEmbedResult, len(request.Items))
		owners := make([]hubspec.HubUserDID, len(request.Items))
		for index, item := range request.Items {
			owners[index] = item.OwnerHubUserDID
		}
		homes := resolveHomes(r.Context(), s, owners)
		groups := map[directoryspec.TenantID][]int{}
		for index, item := range request.Items {
			results[index] = unavailableEmbed(item)
			found := homes[item.OwnerHubUserDID]
			if found.Err != nil || found.Value.missing {
				continue
			}
			groups[found.Value.tenant] = append(groups[found.Value.tenant], index)
		}
		remote := map[directoryspec.TenantID][]int{}
		for tenant, indexes := range groups {
			if string(tenant) != s.TenantID {
				remote[tenant] = indexes
				continue
			}
			local, err := postReader(s).Embeds(
				r.Context(), pickEmbeds(request.Items, indexes))
			if err != nil {
				s.InternalError(r.Context(), w, "read embeds", err)
				return
			}
			for position, index := range indexes {
				results[index] = local[position]
			}
		}
		answers := fanout.Do(r.Context(), remote, func(
			ctx context.Context, tenant directoryspec.TenantID, indexes []int,
		) ([]postsspec.MeshEmbedResult, error) {
			outcome, err := s.Posts.PeerReadEmbeds(ctx, tenant,
				postsspec.MeshReadEmbedsRequest{
					ViewerHubUserDID: request.ViewerHubUserDID,
					ViewerHandle:     request.ViewerHandle,
					Items:            pickEmbeds(request.Items, indexes),
				})
			if err != nil {
				return nil, err
			}
			if outcome.Problem != nil {
				return nil, errors.New(outcome.Problem.Type)
			}
			return outcome.Value.Results, nil
		}, fanout.DefaultDeadline)
		for tenant, indexes := range remote {
			answer := answers[tenant]
			if answer.Err != nil {
				continue
			}
			for position, index := range indexes {
				results[index] = answer.Value[position]
			}
		}
		writeEmbeds(s, w, r, results)
	}
}

func pickEmbeds(
	items []postsspec.MeshEmbedReference, indexes []int,
) []postsspec.MeshEmbedReference {
	picked := make([]postsspec.MeshEmbedReference, len(indexes))
	for position, index := range indexes {
		picked[position] = items[index]
	}
	return picked
}

// PeerReadEmbeds answers another tenant's read after verifying that the
// calling tenant homes the viewer.
func PeerReadEmbeds(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.MeshReadEmbedsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		if !peerViewer(s, w, r, request.ViewerHubUserDID, request.ViewerHandle) {
			return
		}
		results, err := postReader(s).Embeds(r.Context(), request.Items)
		if err != nil {
			s.InternalError(r.Context(), w, "read embeds", err)
			return
		}
		writeEmbeds(s, w, r, results)
	}
}
