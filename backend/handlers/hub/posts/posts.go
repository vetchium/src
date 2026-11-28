// Package posts serves Hub timeline posts (agent-guides/posts.md, "Posts").
// The author's tenant holds the words. A read of another tenant's post goes
// through the local mesh relay and never keeps a copy (PST-OWN-003).
package posts

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	postsspec "github.com/vetchium/src/typespec/hub/posts"
	profilespec "github.com/vetchium/src/typespec/hub/profile"
	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/handlers/hub/blocks"
	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	hubruntime "backend/internal/hub"
	hubauthn "backend/internal/hub/auth"
	"backend/internal/hubquotes"
	"backend/internal/middleware"
	"backend/internal/postid"
	"backend/internal/postread"
)

const (
	// dailyLimit is the most posts of any state and kind one user creates in
	// a rolling 24 hours (PST-POS-003).
	dailyLimit = 100
	window     = 24 * time.Hour
)

const listPurpose = "hub:posts:list"

// listCursor wraps the position key of the owner's tenant. The signature
// binds it to one owner, so a tampered or foreign key is refused here
// before any read.
type listCursor struct {
	Owner string `json:"owner"`
	Key   string `json:"key"`
}

// signKey signs the position key of another tenant for one list. scope
// names what the key may page: a purpose and a scope the browser cannot
// change, so a key never moves to another list.
func signKey(
	s *hubruntime.Server, purpose, scope string, key common.PaginationKey,
) (common.PaginationKey, error) {
	payload, err := json.Marshal(listCursor{Owner: scope, Key: string(key)})
	if err != nil {
		return "", err
	}
	return common.PaginationKey(credentials.SignValue(
		s.CredentialSubkey("pagination"), purpose, payload)), nil
}

func verifyKey(
	s *hubruntime.Server, purpose, scope string, key common.PaginationKey,
) (common.PaginationKey, bool) {
	payload, valid := credentials.VerifySignedValue(
		s.CredentialSubkey("pagination"), purpose, string(key))
	var c listCursor
	if !valid || json.Unmarshal(payload, &c) != nil || c.Owner != scope {
		return "", false
	}
	inner := common.PaginationKey(c.Key)
	return inner, common.IsPaginationKey(inner)
}

func signListKey(
	s *hubruntime.Server, ownerDID pgtype.UUID, key common.PaginationKey,
) (common.PaginationKey, error) {
	return signKey(s, listPurpose, dbvalue.FormatUUID(ownerDID), key)
}

func verifyListKey(
	s *hubruntime.Server, ownerDID pgtype.UUID, key common.PaginationKey,
) (common.PaginationKey, bool) {
	return verifyKey(s, listPurpose, dbvalue.FormatUUID(ownerDID), key)
}

func reader(s *hubruntime.Server) postread.Reader {
	return postread.Reader{Queries: s.Queries, Pictures: s.PictureURLs}
}

// entitledPlans lists the plans that create and edit top-level posts
// (PST-POS-001).
func entitledPlans() []string {
	plans := subscriptionspec.PlansAtOrAbove(subscriptionspec.SilverTier)
	oids := make([]string, 0, len(plans))
	for _, plan := range plans {
		oids = append(oids, string(plan))
	}
	return oids
}

func planRequired() problem.Body {
	return hubproblem.PlanRequiredError(subscriptionspec.SilverTier)
}

func replyPolicy(value *postsspec.ReplyPolicy) sqlc.VetchiumHubPostPolicy {
	if value == nil {
		return sqlc.VetchiumHubPostPolicy(postsspec.ReplyEveryone)
	}
	return sqlc.VetchiumHubPostPolicy(*value)
}

func quotePolicy(value *postsspec.QuotePolicy) sqlc.VetchiumHubPostPolicy {
	if value == nil {
		return sqlc.VetchiumHubPostPolicy(postsspec.QuoteEveryone)
	}
	return sqlc.VetchiumHubPostPolicy(*value)
}

// ownPost reads one live post of the caller after a write.
func ownPost(
	ctx context.Context, s *hubruntime.Server, did pgtype.UUID,
	id postsspec.PostID,
) (postsspec.Post, error) {
	found, err := reader(s).Get(ctx, did, []postsspec.PostID{id})
	if err != nil {
		return postsspec.Post{}, err
	}
	if len(found) != 1 {
		return postsspec.Post{}, errors.New("post missing after write")
	}
	return found[0], nil
}

func writePost(
	s *hubruntime.Server, w http.ResponseWriter, r *http.Request, status int,
	did pgtype.UUID, id postsspec.PostID,
) {
	post, err := ownPost(r.Context(), s, did, id)
	if err != nil {
		s.InternalError(r.Context(), w, "read written post", err)
		return
	}
	page := []postsspec.Post{post}
	if err := attachEmbeds(r.Context(), s, did, page, nil); err != nil {
		s.InternalError(r.Context(), w, "attach embeds", err)
		return
	}
	post = page[0]
	if err := attachEmbeds(
		r.Context(), s, did, []postsspec.Post{post}, nil); err != nil {
		s.InternalError(r.Context(), w, "attach embeds", err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	s.JSON(r.Context(), w, status, post)
}

func Create(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.CreatePostRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		id, err := postid.New()
		if err != nil {
			s.InternalError(r.Context(), w, "mint post ID", err)
			return
		}
		ctx := r.Context()
		tx, err := s.DB.Begin(ctx)
		if err != nil {
			s.InternalError(ctx, w, "begin post creation", err)
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		q := sqlc.New(tx)
		// The lock makes the cap and the insert agree for one author.
		if _, err := q.LockHubUserForPosting(ctx, identity.UserDID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.AuthenticationProblem(
					ctx, w, hubproblem.AuthenticationRequiredError,
					hubauthn.BearerChallenge,
				)
				return
			}
			s.InternalError(ctx, w, "lock post author", err)
			return
		}
		count, err := q.CountHubPostsSince(ctx, sqlc.CountHubPostsSinceParams{
			AuthorHubUserDid: identity.UserDID,
			Since:            dbvalue.Timestamp(s.CurrentTime().Add(-window)),
		})
		if err != nil {
			s.InternalError(ctx, w, "count recent posts", err)
			return
		}
		if count >= dailyLimit {
			s.Problem(ctx, w, hubproblem.HubPostLimitReachedError)
			return
		}
		inserted, err := q.InsertHubPost(ctx, sqlc.InsertHubPostParams{
			PostID: id, Body: dbvalue.Text(request.Body),
			ReplyPolicy:      replyPolicy(request.ReplyPolicy),
			QuotePolicy:      quotePolicy(request.QuotePolicy),
			AuthorHubUserDid: identity.UserDID,
			EntitledPlanOids: entitledPlans(),
			TenantID:         s.TenantID,
		})
		if err != nil {
			s.InternalError(ctx, w, "insert post", err)
			return
		}
		if inserted.InsertedRows == 0 {
			s.Problem(ctx, w, planRequired())
			return
		}
		if err := tx.Commit(ctx); err != nil {
			s.InternalError(ctx, w, "commit post creation", err)
			return
		}
		writePost(s, w, r, http.StatusCreated, identity.UserDID,
			postsspec.PostID(id))
	}
}

// editProblem names the reason an edit changed no row, in the order the
// guide lists: not live, window, revision, plan.
func editProblem(
	state sqlc.GetHubPostEditStateRow, revision int32,
) problem.Body {
	switch {
	case state.State != sqlc.VetchiumHubPostStateLive:
		return hubproblem.HubPostNotFoundError
	case !state.WindowOpen:
		return hubproblem.HubPostEditClosedError
	case state.Revision != revision:
		return hubproblem.HubPostConflictError
	case state.Kind == sqlc.VetchiumHubPostKindPost && !state.PlanEntitled:
		return planRequired()
	default:
		// A concurrent edit won between the statement and this read.
		return hubproblem.HubPostConflictError
	}
}

func Edit(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.EditPostRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		ctx := r.Context()
		identity, _ := middleware.HubIdentityFromContext(ctx)
		row, err := s.Queries.EditHubPost(ctx, sqlc.EditHubPostParams{
			PostID: string(request.PostID), AuthorHubUserDid: identity.UserDID,
			Revision: request.Revision, EntitledPlanOids: entitledPlans(),
			Body: dbvalue.Text(request.Body), TenantID: s.TenantID,
		})
		if err != nil {
			s.InternalError(ctx, w, "edit post", err)
			return
		}
		if row.UpdatedRows == 0 {
			state, err := s.Queries.GetHubPostEditState(
				ctx, sqlc.GetHubPostEditStateParams{
					EntitledPlanOids: entitledPlans(),
					PostID:           string(request.PostID),
					AuthorHubUserDid: identity.UserDID,
				},
			)
			if errors.Is(err, pgx.ErrNoRows) {
				s.Problem(ctx, w, hubproblem.HubPostNotFoundError)
				return
			}
			if err != nil {
				s.InternalError(ctx, w, "read post edit state", err)
				return
			}
			s.Problem(ctx, w, editProblem(state, request.Revision))
			return
		}
		writePost(s, w, r, http.StatusOK, identity.UserDID, request.PostID)
	}
}

func Remove(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.RemovePostRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		ctx := r.Context()
		identity, _ := middleware.HubIdentityFromContext(ctx)
		tx, err := s.DB.Begin(ctx)
		if err != nil {
			s.InternalError(ctx, w, "begin post removal", err)
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		q := sqlc.New(tx)
		// The lock holds the post live until the removal and its event commit.
		ref, err := q.GetHubPostQuoteRefForRemoval(
			ctx, sqlc.GetHubPostQuoteRefForRemovalParams{
				PostID: string(request.PostID), AuthorHubUserDid: identity.UserDID,
			})
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(ctx, w, hubproblem.HubPostNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(ctx, w, "lock post", err)
			return
		}
		row, err := q.RemoveHubPost(ctx, sqlc.RemoveHubPostParams{
			PostID: string(request.PostID), AuthorHubUserDid: identity.UserDID,
			TenantID: s.TenantID,
		})
		if err != nil {
			s.InternalError(ctx, w, "remove post", err)
			return
		}
		if row.RemovedRows == 0 {
			s.Problem(ctx, w, hubproblem.HubPostNotFoundError)
			return
		}
		// An Opening quote enqueues no event (PST-QTE-011).
		if ref.QuoteTargetType.Valid && ref.QuoteTargetType.VetchiumHubQuoteTargetType ==
			sqlc.VetchiumHubQuoteTargetTypeTimelinePost {
			if err := hubquotes.EnqueueUnquoted(ctx, q, hubquotes.Unquoted{
				TargetOwnerDID: ref.QuoteOwnerDid,
				TargetPostID:   ref.QuoteTargetID.String,
				QuotePostID:    string(request.PostID),
				QuoterDID:      identity.UserDID, Version: row.Version,
			}); err != nil {
				s.InternalError(ctx, w, "enqueue unquote", err)
				return
			}
		}
		if err := tx.Commit(ctx); err != nil {
			s.InternalError(ctx, w, "commit post removal", err)
			return
		}
		s.Empty(ctx, w, http.StatusNoContent)
	}
}

func SetPolicies(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.SetPostPoliciesRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		ctx := r.Context()
		identity, _ := middleware.HubIdentityFromContext(ctx)
		row, err := s.Queries.SetHubPostPolicies(
			ctx, sqlc.SetHubPostPoliciesParams{
				ReplyPolicy:      sqlc.VetchiumHubPostPolicy(request.ReplyPolicy),
				QuotePolicy:      sqlc.VetchiumHubPostPolicy(request.QuotePolicy),
				Locked:           request.Locked,
				PostID:           string(request.PostID),
				AuthorHubUserDid: identity.UserDID, TenantID: s.TenantID,
			},
		)
		if err != nil {
			s.InternalError(ctx, w, "set post policies", err)
			return
		}
		if row.UpdatedRows == 0 {
			s.Problem(ctx, w, hubproblem.HubPostNotFoundError)
			return
		}
		writePost(s, w, r, http.StatusOK, identity.UserDID, request.PostID)
	}
}

// owner is the user an address names and where this tenant reads from.
type owner struct {
	did   pgtype.UUID
	local bool
	// handle is the permanent handle when the address was one, else empty.
	handle   string
	tenantID string
}

// resolveOwner finds the post owner. A failure is reported as the
// notFound or unavailable problem the operation declares.
func resolveOwner(
	ctx context.Context, s *hubruntime.Server,
	address profilespec.ProfileAddress, notFound, unavailable problem.Body,
) (owner, problem.Body) {
	resolved, failure := blocks.Lookup(ctx, s, address)
	switch failure {
	case blocks.NotFound:
		return owner{}, notFound
	case blocks.Unavailable:
		return owner{}, unavailable
	}
	did, err := dbvalue.ParseUUID(string(resolved.HubUserDID))
	if err != nil {
		return owner{}, unavailable
	}
	target := owner{
		did: did, local: string(resolved.HomeTenantID) == s.TenantID,
		tenantID: string(resolved.HomeTenantID),
	}
	if resolved.Kind == directoryspec.ProfileSlugKindHandle {
		target.handle = resolved.Slug
	}
	return target, nil
}

func viewerFields(
	ctx context.Context, s *hubruntime.Server, did pgtype.UUID,
) (hubspec.HubUserDID, hubspec.HubHandle, error) {
	handle, err := s.Queries.GetHubProfileViewer(ctx, did)
	if err != nil {
		return "", "", err
	}
	return hubspec.HubUserDID(dbvalue.FormatUUID(did)),
		hubspec.HubHandle(handle), nil
}

func List(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.ListPostsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		ctx := r.Context()
		identity, _ := middleware.HubIdentityFromContext(ctx)
		target, details := resolveOwner(
			ctx, s, request.Owner,
			hubproblem.ProfileNotFoundError, hubproblem.HubPostUnavailableError,
		)
		if details != nil {
			s.Problem(ctx, w, details)
			return
		}
		// A muted owner shows no posts and costs no remote call (PST-BLK-005).
		muted, err := s.Queries.HubUserMuteExists(
			ctx, sqlc.HubUserMuteExistsParams{
				MuterHubUserDid: identity.UserDID, MutedHubUserDid: target.did,
			},
		)
		if err != nil {
			s.InternalError(ctx, w, "read mute state", err)
			return
		}
		response := postsspec.ListPostsResponse{
			Posts: []postsspec.Post{}, Muted: muted,
		}
		if !muted {
			details, err := fill(
				ctx, s, identity.UserDID, target, request, &response,
			)
			if err != nil {
				s.InternalError(ctx, w, "list posts", err)
				return
			}
			if details != nil {
				s.Problem(ctx, w, details)
				return
			}
			if err := attachEmbeds(ctx, s, identity.UserDID, response.Posts,
				ownerKnown(target, response.Posts)); err != nil {
				s.InternalError(ctx, w, "attach embeds", err)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(ctx, w, http.StatusOK, response)
	}
}

// fill reads one page into response. It returns the problem to write, or an
// error for a failure that is not a declared problem.
func fill(
	ctx context.Context, s *hubruntime.Server, viewer pgtype.UUID,
	target owner, request postsspec.ListPostsRequest,
	response *postsspec.ListPostsResponse,
) (problem.Body, error) {
	if request.PaginationKey != nil {
		inner, valid := verifyListKey(s, target.did, *request.PaginationKey)
		if !valid {
			return problem.InvalidPaginationKeyError, nil
		}
		request.PaginationKey = &inner
	}
	if target.local {
		page, next, err := reader(s).List(
			ctx, target.did, request.PaginationKey, request.EffectiveLimit(),
		)
		switch {
		case errors.Is(err, postread.ErrInvalidKey):
			return problem.InvalidPaginationKeyError, nil
		case errors.Is(err, pgx.ErrNoRows):
			return hubproblem.ProfileNotFoundError, nil
		case err != nil:
			return nil, err
		}
		response.Posts = page
		return nil, wrapNext(s, target.did, next, response)
	}
	viewerDID, viewerHandle, err := viewerFields(ctx, s, viewer)
	if err != nil {
		return nil, err
	}
	outcome, err := s.Posts.List(ctx, postsspec.MeshListPostsRequest{
		OwnerHubUserDID:  hubspec.HubUserDID(dbvalue.FormatUUID(target.did)),
		ViewerHubUserDID: viewerDID, ViewerHandle: viewerHandle,
		PaginationKey: request.PaginationKey, Limit: request.Limit,
	})
	if err != nil {
		return hubproblem.HubPostUnavailableError, nil
	}
	if outcome.Problem != nil {
		switch outcome.Problem.Type {
		case problem.InvalidPaginationKeyError.Type:
			return problem.InvalidPaginationKeyError, nil
		case hubproblem.ProfileNotFoundError.Type:
			return hubproblem.ProfileNotFoundError, nil
		default:
			return hubproblem.HubPostUnavailableError, nil
		}
	}
	for _, item := range outcome.List.Posts {
		response.Posts = append(response.Posts, item.Post)
	}
	return nil, wrapNext(
		s, target.did, outcome.List.NextPaginationKey, response)
}

// wrapNext signs the owner tenant's next key for the browser.
func wrapNext(
	s *hubruntime.Server, ownerDID pgtype.UUID, next *common.PaginationKey,
	response *postsspec.ListPostsResponse,
) error {
	if next == nil {
		return nil
	}
	signed, err := signListKey(s, ownerDID, *next)
	if err != nil {
		return err
	}
	response.NextPaginationKey = &signed
	return nil
}

func Get(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.GetPostRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		ctx := r.Context()
		identity, _ := middleware.HubIdentityFromContext(ctx)
		target, details := resolveOwner(
			ctx, s, request.Owner,
			hubproblem.HubPostNotFoundError, hubproblem.HubPostUnavailableError,
		)
		if details != nil {
			s.Problem(ctx, w, details)
			return
		}
		post, details, err := getOne(
			ctx, s, identity.UserDID, target, request.PostID,
		)
		if err != nil {
			s.InternalError(ctx, w, "get post", err)
			return
		}
		if details != nil {
			s.Problem(ctx, w, details)
			return
		}
		page := []postsspec.Post{post}
		if err := attachEmbeds(ctx, s, identity.UserDID, page,
			ownerKnown(target, page)); err != nil {
			s.InternalError(ctx, w, "attach embeds", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(ctx, w, http.StatusOK, page[0])
	}
}

// ownerKnown names the owner of posts as already resolved: every post of one
// list or read has that owner.
func ownerKnown(target owner, posts []postsspec.Post) map[string]userLocation {
	if len(posts) == 0 {
		return nil
	}
	return map[string]userLocation{
		string(posts[0].Owner.Handle): {
			did:    hubspec.HubUserDID(dbvalue.FormatUUID(target.did)),
			tenant: directoryspec.TenantID(target.tenantID),
		},
	}
}

func getOne(
	ctx context.Context, s *hubruntime.Server, viewer pgtype.UUID,
	target owner, id postsspec.PostID,
) (postsspec.Post, problem.Body, error) {
	if target.local {
		found, err := reader(s).Get(ctx, target.did, []postsspec.PostID{id})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && len(found) == 0) {
			return postsspec.Post{}, hubproblem.HubPostNotFoundError, nil
		}
		if err != nil {
			return postsspec.Post{}, nil, err
		}
		return found[0], nil, nil
	}
	viewerDID, viewerHandle, err := viewerFields(ctx, s, viewer)
	if err != nil {
		return postsspec.Post{}, nil, err
	}
	outcome, err := s.Posts.GetMany(ctx, postsspec.MeshGetManyPostsRequest{
		ViewerHubUserDID: viewerDID, ViewerHandle: viewerHandle,
		Posts: []postsspec.MeshPostReference{{
			OwnerHubUserDID: hubspec.HubUserDID(dbvalue.FormatUUID(target.did)),
			PostID:          id,
		}},
	})
	if err != nil || outcome.Problem != nil {
		return postsspec.Post{}, hubproblem.HubPostUnavailableError, nil
	}
	result := outcome.Results.Results[0]
	switch result.Status {
	case postsspec.MeshPostFound:
		return result.Post.Post, nil, nil
	case postsspec.MeshPostNotFound:
		return postsspec.Post{}, hubproblem.HubPostNotFoundError, nil
	default:
		return postsspec.Post{}, hubproblem.HubPostUnavailableError, nil
	}
}
