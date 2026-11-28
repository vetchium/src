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
	directoryproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/dbvalue"
	"backend/internal/fanout"
	"backend/internal/meshapi"
	"backend/internal/meshidentity"
	"backend/internal/postread"
)

func postReader(s *meshapi.Server) postread.Reader {
	return postread.Reader{Queries: s.Queries, Pictures: s.Pictures}
}

// relayViewer checks that the viewer the local hub-api names is a user this
// tenant homes under that handle (PST-RD-003). It writes the problem and
// returns false when it is not.
func relayViewer(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	did hubspec.HubUserDID, handle hubspec.HubHandle,
) bool {
	viewer, err := dbvalue.ParseUUID(string(did))
	if err != nil {
		s.ValidationFailed(r.Context(), w, []string{"viewer_hub_user_did"})
		return false
	}
	stored, err := s.Queries.GetHubProfileViewer(r.Context(), viewer)
	if errors.Is(err, pgx.ErrNoRows) ||
		(err == nil && stored != string(handle)) {
		s.Problem(r.Context(), w, hubproblem.ProfileNotFoundError)
		return false
	}
	if err != nil {
		s.InternalError(r.Context(), w, "read post viewer", err)
		return false
	}
	return true
}

// peerViewer checks that the calling tenant homes the viewer (PST-RD-003).
func peerViewer(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	did hubspec.HubUserDID, handle hubspec.HubHandle,
) bool {
	caller, ok := meshidentity.TenantFromContext(r.Context())
	if !ok {
		s.Problem(r.Context(), w, hubproblem.ProfileNotFoundError)
		return false
	}
	viewer, details, err := s.Directory.ResolveProfileSlug(
		r.Context(), directoryspec.ResolveProfileSlugRequest{Slug: string(handle)},
	)
	if err != nil {
		s.Problem(r.Context(), w, hubproblem.ProfileUnavailableError)
		return false
	}
	if details != nil {
		writeProfileDirectoryProblem(s, w, r, details.Type)
		return false
	}
	if viewer.Kind != directoryspec.ProfileSlugKindHandle ||
		viewer.HubUserDID != did || viewer.HomeTenantID != caller ||
		viewer.Slug != string(handle) {
		s.Problem(r.Context(), w, hubproblem.ProfileNotFoundError)
		return false
	}
	return true
}

// ownerHome finds the tenant that homes a Hub user. It writes the problem
// and returns false when it cannot.
func ownerHome(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	did hubspec.HubUserDID,
) (directoryspec.TenantID, bool) {
	home, details, err := s.Directory.ResolvePrincipal(
		r.Context(), directoryspec.ResolvePrincipalRequest{
			PrincipalType: directoryspec.PrincipalHubUser,
			PrincipalDID:  directoryspec.PrincipalDID(did),
		},
	)
	if err != nil {
		s.Problem(r.Context(), w, hubproblem.ProfileUnavailableError)
		return "", false
	}
	if details != nil {
		writeProfileDirectoryProblem(s, w, r, details.Type)
		return "", false
	}
	return home.HomeTenantID, true
}

func meshPosts(
	did hubspec.HubUserDID, posts []postsspec.Post,
) []postsspec.MeshPost {
	items := make([]postsspec.MeshPost, len(posts))
	for index, post := range posts {
		items[index] = postsspec.MeshPost{Post: post, OwnerHubUserDID: did}
	}
	return items
}

// serveList answers a list of a user this tenant homes.
func serveList(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	request postsspec.MeshListPostsRequest,
) {
	owner, err := dbvalue.ParseUUID(string(request.OwnerHubUserDID))
	if err != nil {
		s.ValidationFailed(r.Context(), w, []string{"owner_hub_user_did"})
		return
	}
	posts, next, err := postReader(s).List(
		r.Context(), owner, request.PaginationKey, request.EffectiveLimit(),
	)
	switch {
	case errors.Is(err, postread.ErrInvalidKey):
		s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
		return
	case errors.Is(err, pgx.ErrNoRows):
		s.Problem(r.Context(), w, hubproblem.ProfileNotFoundError)
		return
	case err != nil:
		s.InternalError(r.Context(), w, "list posts", err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	s.JSON(r.Context(), w, http.StatusOK, postsspec.MeshListPostsResponse{
		Posts:             meshPosts(request.OwnerHubUserDID, posts),
		NextPaginationKey: next,
	})
}

// RelayListPosts answers a local hub-api that lists the posts of a user this
// tenant may not home.
func RelayListPosts(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
		var request postsspec.MeshListPostsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		if !relayViewer(s, w, r, request.ViewerHubUserDID, request.ViewerHandle) {
			return
		}
		home, ok := ownerHome(s, w, r, request.OwnerHubUserDID)
		if !ok {
			return
		}
		if string(home) == s.TenantID {
			serveList(s, w, r, request)
			return
		}
		outcome, err := s.Posts.PeerList(r.Context(), home, request)
		if err != nil {
			s.Problem(r.Context(), w, hubproblem.ProfileUnavailableError)
			return
		}
		if outcome.Problem != nil {
			switch outcome.Problem.Type {
			case problem.InvalidPaginationKeyError.Type:
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
			case hubproblem.ProfileNotFoundError.Type:
				s.Problem(r.Context(), w, hubproblem.ProfileNotFoundError)
			default:
				s.Problem(r.Context(), w, hubproblem.ProfileUnavailableError)
			}
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, outcome.List)
	}
}

// PeerListPosts answers another tenant's list after verifying that the
// calling tenant homes the viewer.
func PeerListPosts(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.MeshListPostsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		if !peerViewer(s, w, r, request.ViewerHubUserDID, request.ViewerHandle) {
			return
		}
		serveList(s, w, r, request)
	}
}

// serveGetMany answers the references whose owners this tenant homes. It
// answers `not-homed` for an owner it does not home and `not-found` for a
// post that is not live. Results keep the order of references.
func serveGetMany(
	ctx context.Context, s *meshapi.Server,
	references []postsspec.MeshPostReference,
) ([]postsspec.MeshPostResult, error) {
	refs := make([]postread.PostRef, len(references))
	for index, reference := range references {
		owner, err := dbvalue.ParseUUID(string(reference.OwnerHubUserDID))
		if err != nil {
			return nil, err
		}
		refs[index] = postread.PostRef{Owner: owner, PostID: reference.PostID}
	}
	batch, err := postReader(s).Posts(ctx, refs)
	if err != nil {
		return nil, err
	}
	results := make([]postsspec.MeshPostResult, len(references))
	for index, reference := range references {
		results[index] = postsspec.MeshPostResult{
			Status:          postsspec.MeshPostNotFound,
			OwnerHubUserDID: reference.OwnerHubUserDID,
			PostID:          reference.PostID,
		}
		if !batch.Homed[refs[index].Owner] {
			results[index].Status = postsspec.MeshPostNotHomed
			continue
		}
		if post, ok := batch.Found[refs[index]]; ok {
			results[index].Status = postsspec.MeshPostFound
			results[index].Post = &postsspec.MeshPost{
				Post: post, OwnerHubUserDID: reference.OwnerHubUserDID,
			}
		}
	}
	return results, nil
}

// home is where the directory says one Hub user lives. missing is true when
// the directory knows no such user.
type home struct {
	tenant  directoryspec.TenantID
	missing bool
}

// resolveHomes asks the directory for the home of each user in parallel
// (PST-RD-001). A user whose lookup failed has an error in its result.
func resolveHomes(
	ctx context.Context, s *meshapi.Server, dids []hubspec.HubUserDID,
) map[hubspec.HubUserDID]fanout.Result[home] {
	unique := map[hubspec.HubUserDID]struct{}{}
	for _, did := range dids {
		unique[did] = struct{}{}
	}
	return fanout.Do(ctx, unique, func(
		ctx context.Context, did hubspec.HubUserDID, _ struct{},
	) (home, error) {
		resolved, details, err := s.Directory.ResolvePrincipal(
			ctx, directoryspec.ResolvePrincipalRequest{
				PrincipalType: directoryspec.PrincipalHubUser,
				PrincipalDID:  directoryspec.PrincipalDID(did),
			})
		if err != nil {
			return home{}, err
		}
		if details != nil {
			if details.Type == directoryproblem.DirectoryEntryNotFoundError.Type {
				return home{missing: true}, nil
			}
			return home{}, errors.New(details.Type)
		}
		return home{tenant: resolved.HomeTenantID}, nil
	}, fanout.DefaultDeadline)
}

func writeGetMany(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	results []postsspec.MeshPostResult,
) {
	w.Header().Set("Cache-Control", "no-store")
	s.JSON(r.Context(), w, http.StatusOK,
		postsspec.MeshGetManyPostsResponse{Results: results})
}

// RelayGetManyPosts answers a local hub-api that reads posts by owner and
// ID. It groups the references by the home tenant of each owner and reads
// each remote tenant in parallel (PST-RD-001).
func RelayGetManyPosts(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
		var request postsspec.MeshGetManyPostsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		if !relayViewer(s, w, r, request.ViewerHubUserDID, request.ViewerHandle) {
			return
		}
		owners := make([]hubspec.HubUserDID, len(request.Posts))
		for index, reference := range request.Posts {
			owners[index] = reference.OwnerHubUserDID
		}
		homes := resolveHomes(r.Context(), s, owners)
		results := make([]postsspec.MeshPostResult, len(request.Posts))
		groups := map[directoryspec.TenantID][]int{}
		for index, reference := range request.Posts {
			found := homes[reference.OwnerHubUserDID]
			switch {
			case found.Err != nil:
				s.Problem(r.Context(), w, hubproblem.ProfileUnavailableError)
				return
			case found.Value.missing:
				// One unknown owner leaves the other posts readable.
				results[index] = postsspec.MeshPostResult{
					Status:          postsspec.MeshPostNotFound,
					OwnerHubUserDID: reference.OwnerHubUserDID,
					PostID:          reference.PostID,
				}
			default:
				groups[found.Value.tenant] = append(
					groups[found.Value.tenant], index)
			}
		}
		remote := map[directoryspec.TenantID][]int{}
		for tenant, indexes := range groups {
			if string(tenant) != s.TenantID {
				remote[tenant] = indexes
				continue
			}
			references := pick(request.Posts, indexes)
			local, err := serveGetMany(r.Context(), s, references)
			if err != nil {
				s.InternalError(r.Context(), w, "get posts", err)
				return
			}
			for position, index := range indexes {
				results[index] = local[position]
			}
		}
		answers := fanout.Do(r.Context(), remote, func(
			ctx context.Context, tenant directoryspec.TenantID, indexes []int,
		) ([]postsspec.MeshPostResult, error) {
			outcome, err := s.Posts.PeerGetMany(ctx, tenant,
				postsspec.MeshGetManyPostsRequest{
					ViewerHubUserDID: request.ViewerHubUserDID,
					ViewerHandle:     request.ViewerHandle,
					Posts:            pick(request.Posts, indexes),
				})
			if err != nil {
				return nil, err
			}
			if outcome.Problem != nil {
				return nil, errors.New(outcome.Problem.Type)
			}
			return outcome.Results.Results, nil
		}, fanout.DefaultDeadline)
		for tenant, indexes := range remote {
			answer := answers[tenant]
			if answer.Err != nil {
				s.Problem(r.Context(), w, hubproblem.ProfileUnavailableError)
				return
			}
			for position, index := range indexes {
				results[index] = answer.Value[position]
			}
		}
		writeGetMany(s, w, r, results)
	}
}

func pick(
	references []postsspec.MeshPostReference, indexes []int,
) []postsspec.MeshPostReference {
	picked := make([]postsspec.MeshPostReference, len(indexes))
	for position, index := range indexes {
		picked[position] = references[index]
	}
	return picked
}

// PeerGetManyPosts answers another tenant's get-many after verifying that
// the calling tenant homes the viewer.
func PeerGetManyPosts(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.MeshGetManyPostsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		if !peerViewer(s, w, r, request.ViewerHubUserDID, request.ViewerHandle) {
			return
		}
		results, err := serveGetMany(r.Context(), s, request.Posts)
		if err != nil {
			s.InternalError(r.Context(), w, "get posts", err)
			return
		}
		writeGetMany(s, w, r, results)
	}
}
