package posts

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	hubspec "github.com/vetchium/src/typespec/hub"
	operationspec "github.com/vetchium/src/typespec/hub/operations"
	postsspec "github.com/vetchium/src/typespec/hub/posts"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	"backend/internal/hubreplies"
	"backend/internal/middleware"
	"backend/internal/postid"
	"backend/internal/postread"
)

const (
	repliesPurpose       = "hub:posts:replies"
	authorRepliesPurpose = "hub:posts:author-replies"
)

func requestDigest(request any) ([]byte, error) {
	data, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(data)
	return sum[:], nil
}

// rejection maps the stored problem of a failed reply command to a problem
// the operation declares. Any other problem means the owner's tenant could
// not decide, so the browser sees an unavailable region.
func rejection(body []byte) problem.Body {
	var details problem.Details
	if json.Unmarshal(body, &details) != nil {
		return hubproblem.HubPostUnavailableError
	}
	switch details.Type {
	case hubproblem.HubPostNotFoundError.Type:
		return hubproblem.HubPostNotFoundError
	case hubproblem.HubPostRepliesClosedError.Type:
		return hubproblem.HubPostRepliesClosedError
	case hubproblem.HubPostReplyRefusedError.Type:
		return hubproblem.HubPostReplyRefusedError
	case hubproblem.HubReplyNotFoundError.Type:
		return hubproblem.HubReplyNotFoundError
	case hubproblem.HubPostLimitReachedError.Type:
		return hubproblem.HubPostLimitReachedError
	case problem.ValidationFailedError.Type:
		refused := problem.ValidationFailedError
		refused.Fields = details.Fields
		return refused
	default:
		return hubproblem.HubPostUnavailableError
	}
}

// checkParent reads the parent reply from the post owner's tenant and asks
// the parent author's tenant whether that author blocked the replier
// (PST-RPL-004). Every failure fails closed.
func checkParent(
	ctx context.Context, s *hubruntime.Server, target owner,
	request postsspec.ReplyRequest, replier pgtype.UUID,
	replierHandle hubspec.HubHandle,
) (problem.Body, error) {
	replierDID := hubspec.HubUserDID(dbvalue.FormatUUID(replier))
	ownerDID := hubspec.HubUserDID(dbvalue.FormatUUID(target.did))
	var parent postsspec.MeshGetReplyResponse
	if target.local {
		found, err := reader(s).Reply(
			ctx, target.did, string(request.PostID), string(*request.ParentReplyID))
		switch {
		case errors.Is(err, postread.ErrPostNotFound):
			return hubproblem.HubPostNotFoundError, nil
		case errors.Is(err, postread.ErrReplyNotFound):
			return hubproblem.HubReplyNotFoundError, nil
		case err != nil:
			return nil, err
		}
		parent = found
	} else {
		outcome, err := s.Posts.GetReply(ctx, postsspec.MeshGetReplyRequest{
			OwnerHubUserDID: ownerDID, PostID: request.PostID,
			ReplyID:          *request.ParentReplyID,
			ViewerHubUserDID: replierDID, ViewerHandle: replierHandle,
		})
		if err != nil {
			return hubproblem.HubPostUnavailableError, nil
		}
		if outcome.Problem != nil {
			switch outcome.Problem.Type {
			case hubproblem.HubPostNotFoundError.Type:
				return hubproblem.HubPostNotFoundError, nil
			case hubproblem.HubReplyNotFoundError.Type:
				return hubproblem.HubReplyNotFoundError, nil
			default:
				return hubproblem.HubPostUnavailableError, nil
			}
		}
		parent = *outcome.Value
	}
	return parentRefusal(parent, ownerDID, replierDID, func(
		author hubspec.HubUserDID, tenant directoryspec.TenantID,
	) (bool, error) {
		return authorBlocked(ctx, s, author, tenant, replierDID, replierHandle)
	})
}

// parentRefusal decides whether a sub-reply may go on, given the parent as
// the owner's tenant read it. blocked asks whether the parent author blocked
// the replier; it runs only when the author is neither the post owner (whose
// tenant checks) nor the replier.
func parentRefusal(
	parent postsspec.MeshGetReplyResponse, owner, replier hubspec.HubUserDID,
	blocked func(hubspec.HubUserDID, directoryspec.TenantID) (bool, error),
) (problem.Body, error) {
	if parent.State != postsspec.ThreadReplyLive {
		return hubproblem.HubReplyNotFoundError, nil
	}
	if parent.ParentReplyID != nil {
		refused := problem.ValidationFailedError
		refused.Fields = []string{"parent_reply_id"}
		return refused, nil
	}
	if parent.AuthorHubUserDID == owner || parent.AuthorHubUserDID == replier {
		return nil, nil
	}
	isBlocked, err := blocked(parent.AuthorHubUserDID, parent.AuthorTenantID)
	if err != nil {
		return hubproblem.HubPostUnavailableError, nil
	}
	if isBlocked {
		return hubproblem.HubPostReplyRefusedError, nil
	}
	return nil, nil
}

func authorBlocked(
	ctx context.Context, s *hubruntime.Server, author hubspec.HubUserDID,
	tenant directoryspec.TenantID, replier hubspec.HubUserDID,
	replierHandle hubspec.HubHandle,
) (bool, error) {
	if string(tenant) == s.TenantID {
		blocker, err := dbvalue.ParseUUID(string(author))
		if err != nil {
			return false, err
		}
		blocked, err := dbvalue.ParseUUID(string(replier))
		if err != nil {
			return false, err
		}
		return s.Queries.HubUserBlockExists(ctx, sqlc.HubUserBlockExistsParams{
			BlockerHubUserDid: blocker, BlockedHubUserDid: blocked,
		})
	}
	outcome, err := s.Blocks.Check(ctx, author, replier, replierHandle)
	if err != nil {
		return false, err
	}
	if outcome.Problem != nil {
		return false, errors.New(outcome.Problem.Type)
	}
	return outcome.Blocked, nil
}

// Reply sends hub-post-reply-register to the post owner's tenant
// (PST-RPL-005). It answers 202 while the command is pending.
func Reply(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.ReplyRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
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
		replierDID, replierHandle, err := viewerFields(ctx, s, identity.UserDID)
		if err != nil {
			s.InternalError(ctx, w, "read replier", err)
			return
		}
		minted, err := postid.New()
		if err != nil {
			s.InternalError(ctx, w, "mint reply ID", err)
			return
		}
		id := postsspec.PostID(minted)
		// A replay returns its stored outcome; a refusal that was true now
		// may have been sent before.
		known, err := s.Commands.Known(ctx,
			federationspec.HubPostReplyRegisterKind, string(request.PostID), key)
		if err != nil {
			s.InternalError(ctx, w, "find reply operation", err)
			return
		}
		if !known {
			if target.handle == "" {
				// An alias can change; the reply row keeps the permanent
				// handle.
				post, details, err := getOne(
					ctx, s, identity.UserDID, target, request.PostID)
				if err != nil {
					s.InternalError(ctx, w, "read reply post", err)
					return
				}
				if details != nil {
					s.Problem(ctx, w, details)
					return
				}
				target.handle = string(post.Owner.Handle)
			}
			if request.ParentReplyID != nil {
				details, err := checkParent(
					ctx, s, target, request, identity.UserDID, replierHandle)
				if err != nil {
					s.InternalError(ctx, w, "check parent reply", err)
					return
				}
				if details != nil {
					s.Problem(ctx, w, details)
					return
				}
			}
		}
		digest, err := requestDigest(request)
		if err != nil {
			s.InternalError(ctx, w, "digest request", err)
			return
		}
		now := s.CurrentTime().UTC()
		payload := federationspec.HubPostReplyRegisterPayload{
			PostID: request.PostID, ReplyID: id,
			ParentReplyID:     request.ParentReplyID,
			ReplierHubUserDID: replierDID, ReplierHandle: replierHandle,
			Body: request.Body, CreatedAt: now,
		}
		var parent *string
		if request.ParentReplyID != nil {
			value := string(*request.ParentReplyID)
			parent = &value
		}
		outcome, err := s.Commands.Send(ctx, commands.Request{
			Kind: federationspec.HubPostReplyRegisterKind,
			Authority: commands.Principal{
				Type: directoryspec.PrincipalHubUser, DID: target.did,
			},
			AggregateID: string(request.PostID),
			Owner: commands.Owner{
				Type: commands.OwnerHubUser,
				ID:   dbvalue.FormatUUID(identity.UserDID),
			},
			IdempotencyKey: key, RequestDigest: digest, Payload: payload,
			Prepare: hubreplies.Prepare(s.TenantID, now, hubreplies.NewReply{
				ReplierDID: identity.UserDID, ReplyID: string(id),
				Post: hubreplies.PostRef{
					OwnerDID: target.did, OwnerHandle: target.handle,
					OwnerTenantID: target.tenantID,
					PostID:        string(request.PostID),
				},
				ParentReplyID: parent, Body: request.Body,
			}),
		})
		if errors.Is(err, commands.ErrIdempotencyConflict) {
			s.Problem(ctx, w, problem.IdempotencyKeyConflictError)
			return
		}
		if err != nil {
			s.InternalError(ctx, w, "send hub-post-reply-register", err)
			return
		}
		writeReplyOutcome(s, w, r, outcome, replierHandle, request)
	}
}

// writeReplyOutcome maps the outcome of the command to the contract: `200`
// with the reply, the stored problem, `202`, or an unavailable owner tenant.
func writeReplyOutcome(
	s *hubruntime.Server, w http.ResponseWriter, r *http.Request,
	outcome commands.Outcome, handle hubspec.HubHandle,
	request postsspec.ReplyRequest,
) {
	ctx := r.Context()
	switch outcome.State {
	case commands.StateSucceeded:
		var result federationspec.HubPostReplyRegisterResult
		if err := json.Unmarshal(outcome.Response.Body, &result); err != nil {
			s.InternalError(ctx, w, "decode reply result", err)
			return
		}
		body := request.Body
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(ctx, w, http.StatusOK, postsspec.Reply{
			ReplyID: result.ReplyID, PostID: request.PostID,
			ParentReplyID: request.ParentReplyID, AuthorHandle: handle,
			Body: &body, State: postsspec.ThreadReplyLive, Revision: 1,
			CreatedAt: result.CreatedAt.UTC(),
		})
	case commands.StateFailed:
		s.Problem(ctx, w, rejection(outcome.Response.Body))
	case commands.StatePending:
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(ctx, w, http.StatusAccepted, operationspec.PendingOperation{
			OperationID: operationspec.OperationID(
				dbvalue.FormatUUID(outcome.OperationID)),
		})
	default:
		s.Problem(ctx, w, hubproblem.HubPostUnavailableError)
	}
}

// editReplyProblem names the reason an edit changed no row, in the order the
// guide lists for a post: not live, window, revision.
func editReplyProblem(
	state sqlc.GetHubReplyTextRow, revision int32,
) problem.Body {
	switch {
	case state.State != sqlc.VetchiumHubReplyTextStateLive:
		return hubproblem.HubReplyNotFoundError
	case !state.WindowOpen:
		return hubproblem.HubPostEditClosedError
	case state.Revision != revision:
		return hubproblem.HubPostConflictError
	default:
		// A concurrent edit won between the statement and this read.
		return hubproblem.HubPostConflictError
	}
}

func ownReplyBody(
	row sqlc.GetHubReplyTextRow, handle hubspec.HubHandle, body string,
	revision int32,
) postsspec.Reply {
	text := body
	reply := postsspec.Reply{
		ReplyID: postsspec.PostID(row.ReplyID), PostID: postsspec.PostID(row.PostID),
		AuthorHandle: handle, Body: &text, State: postsspec.ThreadReplyLive,
		Revision: revision, Edited: revision > 1,
		CreatedAt: row.CreatedAt.Time.UTC(),
	}
	if row.ParentReplyID.Valid {
		parent := postsspec.PostID(row.ParentReplyID.String)
		reply.ParentReplyID = &parent
	}
	return reply
}

// EditReply edits the caller's own live reply and enqueues hub-reply-edited
// for the post owner in the same transaction (PST-RPL-010). The result
// carries no sub-reply count: the post owner's tenant keeps it.
func EditReply(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.EditReplyRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		ctx := r.Context()
		identity, _ := middleware.HubIdentityFromContext(ctx)
		tx, err := s.DB.Begin(ctx)
		if err != nil {
			s.InternalError(ctx, w, "begin reply edit", err)
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		q := sqlc.New(tx)
		current, err := q.GetHubReplyText(ctx, sqlc.GetHubReplyTextParams{
			ReplyID: string(request.ReplyID), AuthorHubUserDid: identity.UserDID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(ctx, w, hubproblem.HubReplyNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(ctx, w, "read reply text", err)
			return
		}
		edited, err := q.EditHubReplyText(ctx, sqlc.EditHubReplyTextParams{
			ReplyID: string(request.ReplyID), AuthorHubUserDid: identity.UserDID,
			Revision: request.Revision, Body: dbvalue.Text(request.Body),
			TenantID: s.TenantID,
		})
		if err != nil {
			s.InternalError(ctx, w, "edit reply text", err)
			return
		}
		if edited.UpdatedRows == 0 {
			s.Problem(ctx, w, editReplyProblem(current, request.Revision))
			return
		}
		if err := hubreplies.EnqueueEdited(ctx, q, hubreplies.Edited{
			PostID: current.PostID, ReplyID: current.ReplyID,
			PostOwnerDID: current.PostOwnerHubUserDid,
			AuthorDID:    identity.UserDID, Body: request.Body,
			Revision: edited.NewRevision, Version: edited.NewVersion,
		}); err != nil {
			s.InternalError(ctx, w, "enqueue reply edit", err)
			return
		}
		if err := tx.Commit(ctx); err != nil {
			s.InternalError(ctx, w, "commit reply edit", err)
			return
		}
		_, handle, err := viewerFields(ctx, s, identity.UserDID)
		if err != nil {
			s.InternalError(ctx, w, "read reply author", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(ctx, w, http.StatusOK,
			ownReplyBody(current, handle, request.Body, edited.NewRevision))
	}
}

// RemoveReply clears the caller's own live reply, or a reply on a removed
// post, and enqueues hub-reply-removed for the post owner in the same
// transaction when the owner still holds a copy (PST-RPL-011).
func RemoveReply(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.RemoveReplyRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		ctx := r.Context()
		identity, _ := middleware.HubIdentityFromContext(ctx)
		tx, err := s.DB.Begin(ctx)
		if err != nil {
			s.InternalError(ctx, w, "begin reply removal", err)
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		q := sqlc.New(tx)
		current, err := q.GetHubReplyText(ctx, sqlc.GetHubReplyTextParams{
			ReplyID: string(request.ReplyID), AuthorHubUserDid: identity.UserDID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(ctx, w, hubproblem.HubReplyNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(ctx, w, "read reply text", err)
			return
		}
		removed, err := q.RemoveHubReplyText(ctx, sqlc.RemoveHubReplyTextParams{
			ReplyID: string(request.ReplyID), AuthorHubUserDid: identity.UserDID,
			TenantID: s.TenantID,
		})
		if err != nil {
			s.InternalError(ctx, w, "remove reply text", err)
			return
		}
		if removed.RemovedRows == 0 {
			s.Problem(ctx, w, hubproblem.HubReplyNotFoundError)
			return
		}
		// After a post removal the owner's tenant keeps no copy to clear.
		if removed.WasLive {
			if err := hubreplies.EnqueueRemoved(ctx, q, hubreplies.Removed{
				PostID: current.PostID, ReplyID: current.ReplyID,
				PostOwnerDID: current.PostOwnerHubUserDid,
				AuthorDID:    identity.UserDID, Version: removed.NewVersion,
			}); err != nil {
				s.InternalError(ctx, w, "enqueue reply removal", err)
				return
			}
		}
		if err := tx.Commit(ctx); err != nil {
			s.InternalError(ctx, w, "commit reply removal", err)
			return
		}
		s.Empty(ctx, w, http.StatusNoContent)
	}
}

// countDeltas applies the count rule (PST-RPL-014) to a state change of one
// structure row: a count goes down only when the row leaves live, and up
// when it returns. The child row count never changes here.
func countDeltas(
	from, to sqlc.VetchiumHubPostReplyState, isSubReply bool,
) (reply, child int32) {
	live := sqlc.VetchiumHubPostReplyStateLive
	switch {
	case from == live && to != live:
		reply = -1
	case from != live && to == live:
		reply = 1
	}
	if isSubReply {
		child = reply
	}
	return reply, child
}

func setReplyState(
	s *hubruntime.Server, state sqlc.VetchiumHubPostReplyState, action string,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.HideReplyRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		ctx := r.Context()
		identity, _ := middleware.HubIdentityFromContext(ctx)
		tx, err := s.DB.Begin(ctx)
		if err != nil {
			s.InternalError(ctx, w, "begin reply state change", err)
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		q := sqlc.New(tx)
		// The contract declares only hub-reply-not-found here, so a post
		// that is not the caller's or not live reads as a missing reply.
		post, err := q.GetHubPostForReply(ctx, string(request.PostID))
		if errors.Is(err, pgx.ErrNoRows) ||
			(err == nil && (post.AuthorHubUserDid != identity.UserDID ||
				post.State != sqlc.VetchiumHubPostStateLive)) {
			s.Problem(ctx, w, hubproblem.HubReplyNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(ctx, w, "lock post", err)
			return
		}
		changed, err := q.SetHubPostReplyState(ctx, sqlc.SetHubPostReplyStateParams{
			NewState: state, PostID: string(request.PostID),
			ReplyID: string(request.ReplyID),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(ctx, w, hubproblem.HubReplyNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(ctx, w, "set reply state", err)
			return
		}
		// A repeat changes nothing and writes no audit event.
		if changed.OldState != changed.NewState {
			replyDelta, childDelta := countDeltas(
				changed.OldState, changed.NewState, changed.ParentReplyID.Valid)
			if _, err := q.AdjustHubPostReplyCounts(ctx,
				sqlc.AdjustHubPostReplyCountsParams{
					ReplyDelta: replyDelta, PostID: string(request.PostID),
					ChildDelta: childDelta, ParentReplyID: changed.ParentReplyID,
				}); err != nil {
				s.InternalError(ctx, w, "adjust reply counts", err)
				return
			}
			payload, err := json.Marshal(map[string]any{
				"schema_version": 1, "post_id": string(request.PostID),
			})
			if err != nil {
				s.InternalError(ctx, w, "encode audit payload", err)
				return
			}
			if err := q.InsertHubPostAuditEvent(ctx,
				sqlc.InsertHubPostAuditEventParams{
					TenantID: s.TenantID, Action: action,
					EntityType: "hub_reply", EntityID: string(request.ReplyID),
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
			s.InternalError(ctx, w, "commit reply state change", err)
			return
		}
		s.Empty(ctx, w, http.StatusNoContent)
	}
}

// HideReply hides a reply of the caller's post from other viewers
// (PST-RPL-012).
func HideReply(s *hubruntime.Server) http.HandlerFunc {
	return setReplyState(s, sqlc.VetchiumHubPostReplyStateHiddenByOwner,
		"hub.post.reply-hidden")
}

func UnhideReply(s *hubruntime.Server) http.HandlerFunc {
	return setReplyState(s, sqlc.VetchiumHubPostReplyStateLive,
		"hub.post.reply-unhidden")
}

// dropMuted removes the replies of authors the viewer muted and strips the
// author DID the browser never sees (PST-THR-005, PST-OWN-004).
func dropMuted(
	replies []postsspec.MeshReply, muted map[hubspec.HubUserDID]bool,
) []postsspec.Reply {
	kept := make([]postsspec.Reply, 0, len(replies))
	for _, reply := range replies {
		if !muted[reply.AuthorHubUserDID] {
			kept = append(kept, reply.Reply)
		}
	}
	return kept
}

func mutedAuthors(
	ctx context.Context, s *hubruntime.Server, viewer pgtype.UUID,
	replies []postsspec.MeshReply,
) (map[hubspec.HubUserDID]bool, error) {
	seen := map[hubspec.HubUserDID]bool{}
	candidates := []pgtype.UUID{}
	for _, reply := range replies {
		if seen[reply.AuthorHubUserDID] {
			continue
		}
		seen[reply.AuthorHubUserDID] = true
		did, err := dbvalue.ParseUUID(string(reply.AuthorHubUserDID))
		if err != nil {
			return nil, err
		}
		candidates = append(candidates, did)
	}
	muted := map[hubspec.HubUserDID]bool{}
	if len(candidates) == 0 {
		return muted, nil
	}
	found, err := s.Queries.HubUserMutedAny(ctx, sqlc.HubUserMutedAnyParams{
		MuterHubUserDid: viewer, CandidateDids: candidates,
	})
	if err != nil {
		return nil, err
	}
	for _, did := range found {
		muted[hubspec.HubUserDID(dbvalue.FormatUUID(did))] = true
	}
	return muted, nil
}

// threadScope binds a signed key to one post and one parent reply of one
// owner.
func threadScope(
	ownerDID pgtype.UUID, postID postsspec.PostID, parent *postsspec.PostID,
) string {
	scope := dbvalue.FormatUUID(ownerDID) + "/" + string(postID)
	if parent != nil {
		scope += "/" + string(*parent)
	}
	return scope
}

// remoteProblem maps a declared problem of a mesh read to the problem the
// operation declares.
func remoteProblem(details *problem.Details, known ...problem.Details) problem.Body {
	for _, candidate := range known {
		if details.Type == candidate.Type {
			return candidate
		}
	}
	return hubproblem.HubPostUnavailableError
}

// ListReplies reads one page of a thread from the post owner's tenant and
// drops the replies of authors the caller muted (PST-THR-005).
func ListReplies(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.ListRepliesRequest
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
		scope := threadScope(target.did, request.PostID, request.ParentReplyID)
		var key *common.PaginationKey
		if request.PaginationKey != nil {
			inner, valid := verifyKey(s, repliesPurpose, scope, *request.PaginationKey)
			if !valid {
				s.Problem(ctx, w, problem.InvalidPaginationKeyError)
				return
			}
			key = &inner
		}
		var page []postsspec.MeshReply
		var next *common.PaginationKey
		if target.local {
			var err error
			page, next, err = reader(s).Thread(
				ctx, target.did, string(request.PostID), request.ParentReplyID,
				request.FromReplyID, identity.UserDID, key,
				request.EffectiveLimit())
			switch {
			case errors.Is(err, postread.ErrInvalidKey):
				s.Problem(ctx, w, problem.InvalidPaginationKeyError)
				return
			case errors.Is(err, postread.ErrPostNotFound):
				s.Problem(ctx, w, hubproblem.HubPostNotFoundError)
				return
			case errors.Is(err, postread.ErrReplyNotFound):
				s.Problem(ctx, w, hubproblem.HubReplyNotFoundError)
				return
			case err != nil:
				s.InternalError(ctx, w, "list replies", err)
				return
			}
		} else {
			viewerDID, viewerHandle, err := viewerFields(ctx, s, identity.UserDID)
			if err != nil {
				s.InternalError(ctx, w, "read thread viewer", err)
				return
			}
			outcome, err := s.Posts.ListReplies(ctx, postsspec.MeshListRepliesRequest{
				OwnerHubUserDID: hubspec.HubUserDID(dbvalue.FormatUUID(target.did)),
				PostID:          request.PostID, ParentReplyID: request.ParentReplyID,
				FromReplyID:      request.FromReplyID,
				ViewerHubUserDID: viewerDID, ViewerHandle: viewerHandle,
				PaginationKey: key, Limit: request.Limit,
			})
			if err != nil {
				s.Problem(ctx, w, hubproblem.HubPostUnavailableError)
				return
			}
			if outcome.Problem != nil {
				s.Problem(ctx, w, remoteProblem(outcome.Problem,
					problem.InvalidPaginationKeyError, hubproblem.HubPostNotFoundError,
					hubproblem.HubReplyNotFoundError))
				return
			}
			page, next = outcome.Value.Replies, outcome.Value.NextPaginationKey
		}
		muted, err := mutedAuthors(ctx, s, identity.UserDID, page)
		if err != nil {
			s.InternalError(ctx, w, "read muted authors", err)
			return
		}
		response := postsspec.ListRepliesResponse{Replies: dropMuted(page, muted)}
		if next != nil {
			signed, err := signKey(s, repliesPurpose, scope, *next)
			if err != nil {
				s.InternalError(ctx, w, "sign reply key", err)
				return
			}
			response.NextPaginationKey = &signed
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(ctx, w, http.StatusOK, response)
	}
}

// LocateReply tells which list a reply is in, so a reply link opens the
// thread at it with list-replies `from_reply_id` (PST-THR-009). It holds no
// words.
func LocateReply(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.LocateReplyRequest
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
		var found postsspec.MeshGetReplyResponse
		if target.local {
			var err error
			found, err = reader(s).Reply(
				ctx, target.did, string(request.PostID), string(request.ReplyID))
			switch {
			case errors.Is(err, postread.ErrPostNotFound):
				s.Problem(ctx, w, hubproblem.HubPostNotFoundError)
				return
			case errors.Is(err, postread.ErrReplyNotFound):
				s.Problem(ctx, w, hubproblem.HubReplyNotFoundError)
				return
			case err != nil:
				s.InternalError(ctx, w, "locate reply", err)
				return
			}
		} else {
			viewerDID, viewerHandle, err := viewerFields(ctx, s, identity.UserDID)
			if err != nil {
				s.InternalError(ctx, w, "read locate viewer", err)
				return
			}
			outcome, err := s.Posts.GetReply(ctx, postsspec.MeshGetReplyRequest{
				OwnerHubUserDID: hubspec.HubUserDID(dbvalue.FormatUUID(target.did)),
				PostID:          request.PostID, ReplyID: request.ReplyID,
				ViewerHubUserDID: viewerDID, ViewerHandle: viewerHandle,
			})
			if err != nil {
				s.Problem(ctx, w, hubproblem.HubPostUnavailableError)
				return
			}
			if outcome.Problem != nil {
				s.Problem(ctx, w, remoteProblem(outcome.Problem,
					hubproblem.HubPostNotFoundError, hubproblem.HubReplyNotFoundError))
				return
			}
			found = *outcome.Value
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(ctx, w, http.StatusOK, postsspec.LocateReplyResponse{
			ReplyID: found.ReplyID, ParentReplyID: found.ParentReplyID,
		})
	}
}

// ListAuthorReplies reads one page of a user's replies for the Replies tab.
// A muted author shows no items (PST-BLK-005).
func ListAuthorReplies(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request postsspec.ListAuthorRepliesRequest
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
		muted, err := s.Queries.HubUserMuteExists(
			ctx, sqlc.HubUserMuteExistsParams{
				MuterHubUserDid: identity.UserDID, MutedHubUserDid: target.did,
			},
		)
		if err != nil {
			s.InternalError(ctx, w, "read mute state", err)
			return
		}
		response := postsspec.ListAuthorRepliesResponse{
			Replies: []postsspec.AuthorReply{}, Muted: muted,
		}
		if !muted {
			details, err := fillAuthorReplies(
				ctx, s, identity.UserDID, target, request, &response)
			if err != nil {
				s.InternalError(ctx, w, "list author replies", err)
				return
			}
			if details != nil {
				s.Problem(ctx, w, details)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(ctx, w, http.StatusOK, response)
	}
}

func fillAuthorReplies(
	ctx context.Context, s *hubruntime.Server, viewer pgtype.UUID,
	target owner, request postsspec.ListAuthorRepliesRequest,
	response *postsspec.ListAuthorRepliesResponse,
) (problem.Body, error) {
	scope := dbvalue.FormatUUID(target.did)
	var key *common.PaginationKey
	if request.PaginationKey != nil {
		inner, valid := verifyKey(
			s, authorRepliesPurpose, scope, *request.PaginationKey)
		if !valid {
			return problem.InvalidPaginationKeyError, nil
		}
		key = &inner
	}
	var next *common.PaginationKey
	if target.local {
		page, more, err := reader(s).AuthorReplies(
			ctx, target.did, key, request.EffectiveLimit())
		switch {
		case errors.Is(err, postread.ErrInvalidKey):
			return problem.InvalidPaginationKeyError, nil
		case errors.Is(err, pgx.ErrNoRows):
			return hubproblem.ProfileNotFoundError, nil
		case err != nil:
			return nil, err
		}
		response.Replies, next = page, more
	} else {
		viewerDID, viewerHandle, err := viewerFields(ctx, s, viewer)
		if err != nil {
			return nil, err
		}
		outcome, err := s.Posts.ListAuthorReplies(ctx,
			postsspec.MeshListAuthorRepliesRequest{
				AuthorHubUserDID: hubspec.HubUserDID(dbvalue.FormatUUID(target.did)),
				ViewerHubUserDID: viewerDID, ViewerHandle: viewerHandle,
				PaginationKey: key, Limit: request.Limit,
			})
		if err != nil {
			return hubproblem.HubPostUnavailableError, nil
		}
		if outcome.Problem != nil {
			return remoteProblem(outcome.Problem,
				problem.InvalidPaginationKeyError, hubproblem.ProfileNotFoundError), nil
		}
		response.Replies = outcome.Value.Replies
		next = outcome.Value.NextPaginationKey
	}
	if next != nil {
		signed, err := signKey(s, authorRepliesPurpose, scope, *next)
		if err != nil {
			return nil, err
		}
		response.NextPaginationKey = &signed
	}
	return nil, nil
}
