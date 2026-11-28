package posts

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	postsspec "github.com/vetchium/src/typespec/hub/posts"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/handlers/hub/blocks"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/fanout"
	hubruntime "backend/internal/hub"
	hubauthn "backend/internal/hub/auth"
	"backend/internal/hubquotes"
	"backend/internal/middleware"
	"backend/internal/postid"
	"backend/internal/postread"
)

const quotesPurpose = "hub:posts:quotes"

// quoteTarget is what CreateQuote resolved before it opens a transaction.
type quoteTarget struct {
	targetType sqlc.VetchiumHubQuoteTargetType
	// principalType, did, address, and tenantID are the stored reference.
	principalType string
	did           pgtype.UUID
	address       string
	tenantID      string
	id            string
	// embed is the target as the quoter's tenant read it.
	embed *postsspec.PostEmbed
	// ownerDID is the target post owner who gets the event; it is set only
	// for a timeline target.
	ownerDID pgtype.UUID
}

// readTimelineTarget reads the post to quote from its owner's tenant
// (PST-QTE-003). It returns the problem to write, or an error that is not a
// declared problem.
func readTimelineTarget(
	ctx context.Context, s *hubruntime.Server, quoter pgtype.UUID,
	quoterHandle hubspec.HubHandle, request postsspec.QuoteTarget,
) (quoteTarget, problem.Body, error) {
	target, details := resolveOwner(
		ctx, s, request.Owner,
		hubproblem.HubPostNotFoundError, hubproblem.HubPostUnavailableError,
	)
	if details != nil {
		return quoteTarget{}, details, nil
	}
	var post postsspec.Post
	if target.local {
		var err error
		post, err = reader(s).QuoteTarget(
			ctx, target.did, string(request.PostID), quoter)
		switch {
		case errors.Is(err, postread.ErrPostNotFound),
			errors.Is(err, pgx.ErrNoRows):
			return quoteTarget{}, hubproblem.HubPostNotFoundError, nil
		case errors.Is(err, postread.ErrQuoteRefused):
			return quoteTarget{}, hubproblem.HubPostQuoteRefusedError, nil
		case err != nil:
			return quoteTarget{}, nil, err
		}
	} else {
		outcome, err := s.Posts.ReadQuoteTarget(ctx,
			postsspec.MeshReadQuoteTargetRequest{
				OwnerHubUserDID: hubspec.HubUserDID(dbvalue.FormatUUID(target.did)),
				TargetPostID:    request.PostID,
				ViewerHubUserDID: hubspec.HubUserDID(
					dbvalue.FormatUUID(quoter)),
				ViewerHandle: quoterHandle,
			})
		if err != nil {
			return quoteTarget{}, hubproblem.HubPostUnavailableError, nil
		}
		if outcome.Problem != nil {
			return quoteTarget{}, remoteProblem(outcome.Problem,
				hubproblem.HubPostNotFoundError,
				hubproblem.HubPostQuoteRefusedError), nil
		}
		post = outcome.Value.Post
	}
	embedded := post.Embedded()
	return quoteTarget{
		targetType:    sqlc.VetchiumHubQuoteTargetTypeTimelinePost,
		principalType: "hub_user", did: target.did,
		address:  string(post.Owner.Handle),
		tenantID: target.tenantID, id: string(request.PostID),
		ownerDID: target.did,
		embed: &postsspec.PostEmbed{
			State: postsspec.EmbedPost, Post: &embedded,
		},
	}, nil, nil
}

// readOpeningTarget reads the published Opening to quote (PST-QTE-011).
func readOpeningTarget(
	ctx context.Context, s *hubruntime.Server, request postsspec.QuoteTarget,
) (quoteTarget, problem.Body, error) {
	org, details, err := s.Directory.ResolveOrgDomain(
		ctx, directoryspec.ResolveOrgDomainRequest{Domain: request.OrgDomain})
	if err != nil {
		return quoteTarget{}, hubproblem.HubPostUnavailableError, nil
	}
	if details != nil {
		if details.Type == coordinatorproblem.DirectoryEntryNotFoundError.Type {
			return quoteTarget{}, hubproblem.OpeningNotFoundError, nil
		}
		return quoteTarget{}, hubproblem.HubPostUnavailableError, nil
	}
	did, err := dbvalue.ParseUUID(string(org.OrgDID))
	if err != nil {
		return quoteTarget{}, hubproblem.HubPostUnavailableError, nil
	}
	opening, status := readOpening(ctx, s, request.OrgDomain, request.OpeningNumber)
	switch status {
	case openingGone:
		return quoteTarget{}, hubproblem.OpeningNotFoundError, nil
	case openingFailed:
		return quoteTarget{}, hubproblem.HubPostUnavailableError, nil
	}
	return quoteTarget{
		targetType:    sqlc.VetchiumHubQuoteTargetTypeOpening,
		principalType: "org", did: did, address: string(request.OrgDomain),
		tenantID: string(org.HomeTenantID),
		id:       openingTargetID(request.OpeningNumber),
		embed: &postsspec.PostEmbed{
			State: postsspec.EmbedOpening, Opening: &opening,
		},
	}, nil, nil
}

// CreateQuote quotes a timeline post or a published Opening. Every plan
// quotes (PST-QTE-001). The target read comes first, so a refused quote
// writes nothing; the insert, the audit event, and the hub-post-quoted event
// then commit together (PST-QTE-004).
func CreateQuote(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.CreateQuoteRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		ctx := r.Context()
		identity, _ := middleware.HubIdentityFromContext(ctx)
		_, quoterHandle, err := viewerFields(ctx, s, identity.UserDID)
		if err != nil {
			s.InternalError(ctx, w, "read quoter", err)
			return
		}
		var target quoteTarget
		var details problem.Body
		if request.Target.Type == postsspec.QuoteTargetTimelinePost {
			target, details, err = readTimelineTarget(
				ctx, s, identity.UserDID, quoterHandle, request.Target)
		} else {
			target, details, err = readOpeningTarget(ctx, s, request.Target)
		}
		if err != nil {
			s.InternalError(ctx, w, "read quote target", err)
			return
		}
		if details != nil {
			s.Problem(ctx, w, details)
			return
		}
		id, err := postid.New()
		if err != nil {
			s.InternalError(ctx, w, "mint quote ID", err)
			return
		}
		tx, err := s.DB.Begin(ctx)
		if err != nil {
			s.InternalError(ctx, w, "begin quote creation", err)
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		q := sqlc.New(tx)
		if _, err := q.LockHubUserForPosting(ctx, identity.UserDID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.AuthenticationProblem(
					ctx, w, hubproblem.AuthenticationRequiredError,
					hubauthn.BearerChallenge,
				)
				return
			}
			s.InternalError(ctx, w, "lock quote author", err)
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
		inserted, err := q.InsertHubQuotePost(ctx, sqlc.InsertHubQuotePostParams{
			PostID: id, Body: dbvalue.Text(request.Body),
			ReplyPolicy: replyPolicy(request.ReplyPolicy),
			QuotePolicy: quotePolicy(request.QuotePolicy),
			QuoteTargetType: sqlc.NullVetchiumHubQuoteTargetType{
				VetchiumHubQuoteTargetType: target.targetType, Valid: true,
			},
			QuoteOwnerPrincipalType: target.principalType,
			QuoteOwnerDid:           target.did,
			QuoteOwnerAddress:       target.address,
			QuoteOwnerTenantID:      target.tenantID,
			QuoteTargetID:           target.id,
			AuthorHubUserDid:        identity.UserDID,
			TenantID:                s.TenantID,
		})
		if err != nil {
			s.InternalError(ctx, w, "insert quote post", err)
			return
		}
		if inserted.InsertedRows == 0 {
			s.AuthenticationProblem(
				ctx, w, hubproblem.AuthenticationRequiredError,
				hubauthn.BearerChallenge,
			)
			return
		}
		if target.ownerDID.Valid {
			if err := hubquotes.EnqueueQuoted(ctx, q, hubquotes.Quoted{
				TargetOwnerDID: target.ownerDID, TargetPostID: target.id,
				QuotePostID: id, QuoterDID: identity.UserDID,
				QuoterHandle: string(quoterHandle),
				CreatedAt:    s.CurrentTime(), Version: inserted.Version,
			}); err != nil {
				s.InternalError(ctx, w, "enqueue quote", err)
				return
			}
		}
		if err := tx.Commit(ctx); err != nil {
			s.InternalError(ctx, w, "commit quote creation", err)
			return
		}
		post, err := ownPost(ctx, s, identity.UserDID, postsspec.PostID(id))
		if err != nil {
			s.InternalError(ctx, w, "read written quote", err)
			return
		}
		// The owner's tenant records the quote only after the event arrives,
		// so the embed comes from the read that allowed the quote.
		post.Embed = target.embed
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(ctx, w, http.StatusCreated, post)
	}
}

// DetachQuote lets the owner of the target post detach a quote
// (PST-QTE-008). A repeat changes nothing.
func DetachQuote(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.DetachQuoteRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		ctx := r.Context()
		identity, _ := middleware.HubIdentityFromContext(ctx)
		resolved, failure := blocks.Lookup(ctx, s, request.Quoter)
		switch failure {
		case blocks.NotFound:
			s.Problem(ctx, w, hubproblem.HubPostNotFoundError)
			return
		case blocks.Unavailable:
			s.InternalError(ctx, w, "resolve quoter",
				errors.New("directory unavailable"))
			return
		}
		quoter, err := dbvalue.ParseUUID(string(resolved.HubUserDID))
		if err != nil {
			s.InternalError(ctx, w, "parse quoter", err)
			return
		}
		tx, err := s.DB.Begin(ctx)
		if err != nil {
			s.InternalError(ctx, w, "begin quote detach", err)
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		q := sqlc.New(tx)
		target, err := q.GetHubPostForReply(ctx, string(request.PostID))
		if errors.Is(err, pgx.ErrNoRows) ||
			(err == nil && (target.AuthorHubUserDid != identity.UserDID ||
				target.State != sqlc.VetchiumHubPostStateLive)) {
			s.Problem(ctx, w, hubproblem.HubPostNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(ctx, w, "lock quote target", err)
			return
		}
		quote, err := q.GetHubPostQuote(ctx, sqlc.GetHubPostQuoteParams{
			TargetPostID: string(request.PostID),
			QuotePostID:  string(request.QuotePostID),
		})
		if errors.Is(err, pgx.ErrNoRows) ||
			(err == nil && quote.QuoterHubUserDid != quoter) {
			s.Problem(ctx, w, hubproblem.HubPostNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(ctx, w, "read quote", err)
			return
		}
		changed, err := q.DetachHubPostQuote(ctx, sqlc.DetachHubPostQuoteParams{
			TargetPostID: string(request.PostID),
			QuotePostID:  string(request.QuotePostID),
		})
		if err != nil {
			s.InternalError(ctx, w, "detach quote", err)
			return
		}
		if changed == 1 {
			if _, err := q.DecrementHubPostQuoteCount(
				ctx, string(request.PostID)); err != nil {
				s.InternalError(ctx, w, "reduce quote count", err)
				return
			}
			payload, err := json.Marshal(map[string]any{
				"schema_version": 1, "post_id": string(request.PostID),
				"quote_post_id": string(request.QuotePostID),
			})
			if err != nil {
				s.InternalError(ctx, w, "encode audit payload", err)
				return
			}
			if err := q.InsertHubPostAuditEvent(ctx,
				sqlc.InsertHubPostAuditEventParams{
					TenantID: s.TenantID, Action: "hub.post.quote-detached",
					EntityType: "hub_post", EntityID: string(request.PostID),
					ActorType:         "hub_user",
					ActorID:           dbvalue.FormatUUID(identity.UserDID),
					SubjectHubUserDid: identity.UserDID, Source: "hub-api",
					Payload: payload,
				}); err != nil {
				s.InternalError(ctx, w, "write audit event", err)
				return
			}
		}
		if err := tx.Commit(ctx); err != nil {
			s.InternalError(ctx, w, "commit quote detach", err)
			return
		}
		s.Empty(ctx, w, http.StatusNoContent)
	}
}

// quoteScope binds a signed key to one post of one owner.
func quoteScope(ownerDID pgtype.UUID, postID postsspec.PostID) string {
	return dbvalue.FormatUUID(ownerDID) + "/" + string(postID)
}

// readQuoteRefs reads one page of the quote index from the target owner's
// tenant.
func readQuoteRefs(
	ctx context.Context, s *hubruntime.Server, viewer pgtype.UUID,
	target owner, request postsspec.ListQuotesRequest,
	key *common.PaginationKey,
) ([]postsspec.MeshQuoteReference, *common.PaginationKey, problem.Body, error) {
	if target.local {
		refs, next, err := reader(s).Quotes(ctx, target.did,
			string(request.PostID), key, request.EffectiveLimit())
		switch {
		case errors.Is(err, postread.ErrInvalidKey):
			return nil, nil, problem.InvalidPaginationKeyError, nil
		case errors.Is(err, postread.ErrPostNotFound):
			return nil, nil, hubproblem.HubPostNotFoundError, nil
		case err != nil:
			return nil, nil, nil, err
		}
		return refs, next, nil, nil
	}
	viewerDID, viewerHandle, err := viewerFields(ctx, s, viewer)
	if err != nil {
		return nil, nil, nil, err
	}
	outcome, err := s.Posts.ListQuotes(ctx, postsspec.MeshListQuotesRequest{
		OwnerHubUserDID:  hubspec.HubUserDID(dbvalue.FormatUUID(target.did)),
		PostID:           request.PostID,
		ViewerHubUserDID: viewerDID, ViewerHandle: viewerHandle,
		PaginationKey: key, Limit: request.Limit,
	})
	if err != nil {
		return nil, nil, hubproblem.HubPostUnavailableError, nil
	}
	if outcome.Problem != nil {
		return nil, nil, remoteProblem(outcome.Problem,
			problem.InvalidPaginationKeyError, hubproblem.HubPostNotFoundError), nil
	}
	return outcome.Value.Quotes, outcome.Value.NextPaginationKey, nil, nil
}

// dropMutedQuoters removes the quotes of users the viewer muted
// (PST-BLK-005).
func dropMutedQuoters(
	ctx context.Context, s *hubruntime.Server, viewer pgtype.UUID,
	refs []postsspec.MeshQuoteReference,
) ([]postsspec.MeshQuoteReference, error) {
	candidates := make([]pgtype.UUID, 0, len(refs))
	for _, ref := range refs {
		did, err := dbvalue.ParseUUID(string(ref.QuoterHubUserDID))
		if err != nil {
			return nil, err
		}
		candidates = append(candidates, did)
	}
	if len(candidates) == 0 {
		return refs, nil
	}
	found, err := s.Queries.HubUserMutedAny(ctx, sqlc.HubUserMutedAnyParams{
		MuterHubUserDid: viewer, CandidateDids: candidates,
	})
	if err != nil {
		return nil, err
	}
	muted := map[hubspec.HubUserDID]bool{}
	for _, did := range found {
		muted[hubspec.HubUserDID(dbvalue.FormatUUID(did))] = true
	}
	kept := make([]postsspec.MeshQuoteReference, 0, len(refs))
	for _, ref := range refs {
		if !muted[ref.QuoterHubUserDID] {
			kept = append(kept, ref)
		}
	}
	return kept, nil
}

// groupQuoteRefs groups the quote references by the home tenant hint of their
// quoters, so one slow region costs only its own quotes.
func groupQuoteRefs(
	refs []postsspec.MeshQuoteReference,
) map[directoryspec.TenantID][]postsspec.MeshPostReference {
	groups := map[directoryspec.TenantID][]postsspec.MeshPostReference{}
	for _, ref := range refs {
		groups[ref.QuoterTenantID] = append(groups[ref.QuoterTenantID],
			postsspec.MeshPostReference{
				OwnerHubUserDID: ref.QuoterHubUserDID, PostID: ref.QuotePostID,
			})
	}
	return groups
}

// regionRead is one region's answer to a get-many.
type regionRead struct {
	found    map[postsspec.PostID]postsspec.Post
	notHomed []postsspec.MeshPostReference
}

func readRegion(
	ctx context.Context, s *hubruntime.Server, viewerDID hubspec.HubUserDID,
	viewerHandle hubspec.HubHandle, refs []postsspec.MeshPostReference,
) (regionRead, error) {
	outcome, err := s.Posts.GetMany(ctx, postsspec.MeshGetManyPostsRequest{
		ViewerHubUserDID: viewerDID, ViewerHandle: viewerHandle, Posts: refs,
	})
	if err != nil {
		return regionRead{}, err
	}
	if outcome.Problem != nil {
		return regionRead{}, errors.New(outcome.Problem.Type)
	}
	read := regionRead{found: map[postsspec.PostID]postsspec.Post{}}
	for index, result := range outcome.Results.Results {
		switch result.Status {
		case postsspec.MeshPostFound:
			read.found[result.PostID] = result.Post.Post
		case postsspec.MeshPostNotHomed:
			read.notHomed = append(read.notHomed, refs[index])
		}
	}
	return read, nil
}

// readQuotePosts reads the quote posts from the home tenant of each quoter in
// parallel (PST-QTE-012). A region that did not answer sets partial and its
// quotes stay out. A quoter that moved is read once more at the new tenant.
func readQuotePosts(
	ctx context.Context, s *hubruntime.Server, viewer pgtype.UUID,
	refs []postsspec.MeshQuoteReference,
) (map[postsspec.PostID]postsspec.Post, bool, error) {
	viewerDID, viewerHandle, err := viewerFields(ctx, s, viewer)
	if err != nil {
		return nil, false, err
	}
	partial := false
	posts := map[postsspec.PostID]postsspec.Post{}
	moved := []postsspec.MeshPostReference{}
	answers := fanout.Do(ctx, groupQuoteRefs(refs), func(
		ctx context.Context, _ directoryspec.TenantID,
		group []postsspec.MeshPostReference,
	) (regionRead, error) {
		return readRegion(ctx, s, viewerDID, viewerHandle, group)
	}, fanout.DefaultDeadline)
	for _, answer := range answers {
		if answer.Err != nil {
			partial = true
			continue
		}
		for id, post := range answer.Value.found {
			posts[id] = post
		}
		moved = append(moved, answer.Value.notHomed...)
	}
	if len(moved) == 0 {
		return posts, partial, nil
	}
	byDID := map[string]postsspec.MeshPostReference{}
	dids := make([]string, 0, len(moved))
	for _, ref := range moved {
		byDID[string(ref.OwnerHubUserDID)] = ref
		dids = append(dids, string(ref.OwnerHubUserDID))
	}
	retried, unresolved := fanout.Regroup(ctx, dids,
		func(ctx context.Context, did string) (string, error) {
			home, details, err := s.Directory.ResolvePrincipal(ctx,
				directoryspec.ResolvePrincipalRequest{
					PrincipalType: directoryspec.PrincipalHubUser,
					PrincipalDID:  directoryspec.PrincipalDID(did),
				})
			if err != nil || details != nil {
				return "", errors.New("principal not resolved")
			}
			return string(home.HomeTenantID), nil
		},
		func(ctx context.Context, _ string, group []string) (regionRead, error) {
			again := make([]postsspec.MeshPostReference, len(group))
			for index, did := range group {
				again[index] = byDID[did]
			}
			return readRegion(ctx, s, viewerDID, viewerHandle, again)
		}, fanout.DefaultDeadline)
	if len(unresolved) > 0 {
		partial = true
	}
	for _, answer := range retried {
		if answer.Err != nil {
			partial = true
			continue
		}
		for id, post := range answer.Value.found {
			posts[id] = post
		}
		// A quoter that is not homed twice stays unread.
		if len(answer.Value.notHomed) > 0 {
			partial = true
		}
	}
	return posts, partial, nil
}

// ListQuotes lists the quote posts of a post (PST-QTE-012). The target
// owner's tenant gives the index and its pagination key; the quote posts come
// from each quoter's tenant.
func ListQuotes(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.ListQuotesRequest
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
		scope := quoteScope(target.did, request.PostID)
		var key *common.PaginationKey
		if request.PaginationKey != nil {
			inner, valid := verifyKey(s, quotesPurpose, scope, *request.PaginationKey)
			if !valid {
				s.Problem(ctx, w, problem.InvalidPaginationKeyError)
				return
			}
			key = &inner
		}
		refs, next, details, err := readQuoteRefs(
			ctx, s, identity.UserDID, target, request, key)
		if err != nil {
			s.InternalError(ctx, w, "read quote index", err)
			return
		}
		if details != nil {
			s.Problem(ctx, w, details)
			return
		}
		refs, err = dropMutedQuoters(ctx, s, identity.UserDID, refs)
		if err != nil {
			s.InternalError(ctx, w, "read muted quoters", err)
			return
		}
		response := postsspec.ListQuotesResponse{Posts: []postsspec.Post{}}
		if len(refs) > 0 {
			found, partial, err := readQuotePosts(ctx, s, identity.UserDID, refs)
			if err != nil {
				s.InternalError(ctx, w, "read quote posts", err)
				return
			}
			response.Partial = partial
			known := map[string]userLocation{}
			for _, ref := range refs {
				post, ok := found[ref.QuotePostID]
				if !ok || !quotes(post, request.PostID) {
					continue
				}
				response.Posts = append(response.Posts, post)
				known[string(ref.QuoterHandle)] = userLocation{
					did:    ref.QuoterHubUserDID,
					tenant: ref.QuoterTenantID,
				}
			}
			if err := attachEmbeds(
				ctx, s, identity.UserDID, response.Posts, known); err != nil {
				s.InternalError(ctx, w, "attach embeds", err)
				return
			}
		}
		if next != nil {
			signed, err := signKey(s, quotesPurpose, scope, *next)
			if err != nil {
				s.InternalError(ctx, w, "sign quote key", err)
				return
			}
			response.NextPaginationKey = &signed
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(ctx, w, http.StatusOK, response)
	}
}

// quotes reports whether post is a quote of the timeline post id. The
// quoter's tenant holds the words, so the owner's index alone is not proof.
func quotes(post postsspec.Post, id postsspec.PostID) bool {
	target := post.QuoteTarget
	return post.Kind == postsspec.KindQuote && target != nil &&
		target.Type == postsspec.QuoteTargetTimelinePost && target.PostID == id
}
