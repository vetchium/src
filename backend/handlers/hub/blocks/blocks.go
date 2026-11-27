// Package blocks serves one-way blocks and mutes between Hub users
// (agent-guides/posts.md, "Blocks and mutes"). The blocker's or muter's tenant
// holds the rows.
package blocks

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	blocksspec "github.com/vetchium/src/typespec/hub/blocks"
	profilespec "github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
)

const (
	blocksPurpose = "hub:blocks:list"
	mutesPurpose  = "hub:mutes:list"
)

// target is the other user: the DID and permanent handle the row keeps, and
// the home tenant as the routing hint.
type target struct {
	did      pgtype.UUID
	handle   string
	tenantID string
}

// resolve finds the user an address names. It writes the problem and returns
// false when it cannot.
func resolve(
	s *hubruntime.Server, w http.ResponseWriter, r *http.Request,
	address profilespec.ProfileAddress,
) (target, bool) {
	ctx := r.Context()
	resolved, details, err := s.Directory.ResolveProfileSlug(
		ctx, directoryspec.ResolveProfileSlugRequest{Slug: string(address)},
	)
	if err != nil {
		s.Problem(ctx, w, hubproblem.ProfileUnavailableError)
		return target{}, false
	}
	if details != nil {
		if details.Type == coordinatorproblem.DirectoryEntryNotFoundError.Type {
			s.Problem(ctx, w, hubproblem.ProfileNotFoundError)
		} else {
			s.Problem(ctx, w, hubproblem.ProfileUnavailableError)
		}
		return target{}, false
	}
	did, err := dbvalue.ParseUUID(string(resolved.HubUserDID))
	if err != nil {
		s.Problem(ctx, w, hubproblem.ProfileUnavailableError)
		return target{}, false
	}
	identity, _ := middleware.HubIdentityFromContext(ctx)
	if did == identity.UserDID {
		s.ValidationFailed(ctx, w, []string{"user"})
		return target{}, false
	}
	handle := resolved.Slug
	if resolved.Kind != directoryspec.ProfileSlugKindHandle {
		// An alias can change; the row keeps the permanent handle.
		var ok bool
		if handle, ok = permanentHandle(s, w, r, identity, address); !ok {
			return target{}, false
		}
	}
	return target{
		did: did, handle: handle, tenantID: string(resolved.HomeTenantID),
	}, true
}

// permanentHandle reads the profile through the profile relay, which checks
// the viewer and finds the owner's tenant.
func permanentHandle(
	s *hubruntime.Server, w http.ResponseWriter, r *http.Request,
	identity middleware.HubIdentity, address profilespec.ProfileAddress,
) (string, bool) {
	ctx := r.Context()
	viewer, err := s.Queries.GetHubProfileViewer(ctx, identity.UserDID)
	if err != nil {
		s.InternalError(ctx, w, "read block viewer", err)
		return "", false
	}
	outcome, err := s.Profiles.RelayRead(
		ctx, profilespec.RelayReadProfileRequest{
			ViewerHubUserDID: hubspec.HubUserDID(
				dbvalue.FormatUUID(identity.UserDID),
			),
			ViewerHandle: hubspec.HubHandle(viewer),
			Address:      address,
		},
	)
	if err != nil || (outcome.Profile == nil && outcome.Problem == nil) {
		s.Problem(ctx, w, hubproblem.ProfileUnavailableError)
		return "", false
	}
	if outcome.Problem != nil {
		if outcome.Problem.Type == hubproblem.ProfileNotFoundError.Type {
			s.Problem(ctx, w, hubproblem.ProfileNotFoundError)
		} else {
			s.Problem(ctx, w, hubproblem.ProfileUnavailableError)
		}
		return "", false
	}
	return string(outcome.Profile.Handle), true
}

// change is the shared shape of block, unblock, mute, and unmute: decode,
// resolve, run one statement that changes the row and its audit event, and
// answer 204.
func change(
	s *hubruntime.Server,
	run func(context.Context, pgtype.UUID, target) error,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request blocksspec.BlockUserRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		other, ok := resolve(s, w, r, request.User)
		if !ok {
			return
		}
		if err := run(r.Context(), identity.UserDID, other); err != nil {
			s.InternalError(r.Context(), w, "change Hub user block", err)
			return
		}
		s.Empty(r.Context(), w, http.StatusNoContent)
	}
}

func Block(s *hubruntime.Server) http.HandlerFunc {
	return change(s, func(ctx context.Context, me pgtype.UUID, t target) error {
		_, err := s.Queries.InsertHubUserBlock(ctx, sqlc.InsertHubUserBlockParams{
			BlockerHubUserDid: me, BlockedHubUserDid: t.did,
			BlockedHandle: t.handle, BlockedTenantID: t.tenantID,
			TenantID: s.TenantID,
		})
		return err
	})
}

func Unblock(s *hubruntime.Server) http.HandlerFunc {
	return change(s, func(ctx context.Context, me pgtype.UUID, t target) error {
		_, err := s.Queries.DeleteHubUserBlock(ctx, sqlc.DeleteHubUserBlockParams{
			BlockerHubUserDid: me, BlockedHubUserDid: t.did,
			TenantID: s.TenantID,
		})
		return err
	})
}

func Mute(s *hubruntime.Server) http.HandlerFunc {
	return change(s, func(ctx context.Context, me pgtype.UUID, t target) error {
		_, err := s.Queries.InsertHubUserMute(ctx, sqlc.InsertHubUserMuteParams{
			MuterHubUserDid: me, MutedHubUserDid: t.did,
			MutedHandle: t.handle, MutedTenantID: t.tenantID,
			TenantID: s.TenantID,
		})
		return err
	})
}

func Unmute(s *hubruntime.Server) http.HandlerFunc {
	return change(s, func(ctx context.Context, me pgtype.UUID, t target) error {
		_, err := s.Queries.DeleteHubUserMute(ctx, sqlc.DeleteHubUserMuteParams{
			MuterHubUserDid: me, MutedHubUserDid: t.did,
			TenantID: s.TenantID,
		})
		return err
	})
}

// State tells whether the caller blocked and muted one user.
func State(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request blocksspec.BlockUserRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		other, ok := resolve(s, w, r, request.User)
		if !ok {
			return
		}
		blocked, err := s.Queries.HubUserBlockExists(
			r.Context(), sqlc.HubUserBlockExistsParams{
				BlockerHubUserDid: identity.UserDID, BlockedHubUserDid: other.did,
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "read block state", err)
			return
		}
		muted, err := s.Queries.HubUserMuteExists(
			r.Context(), sqlc.HubUserMuteExistsParams{
				MuterHubUserDid: identity.UserDID, MutedHubUserDid: other.did,
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "read mute state", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK,
			blocksspec.BlockState{Blocked: blocked, Muted: muted})
	}
}

// cursor positions a page; the signature binds it to one user and list.
type cursor struct {
	HubUser string    `json:"hub_user"`
	At      time.Time `json:"at"`
	Other   string    `json:"other"`
}

func sign(
	s *hubruntime.Server, purpose string, c cursor,
) (common.PaginationKey, error) {
	payload, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	return common.PaginationKey(credentials.SignValue(
		s.CredentialSubkey("pagination"), purpose, payload)), nil
}

func verify(
	s *hubruntime.Server, purpose string, key common.PaginationKey,
	hubUser string,
) (cursor, pgtype.UUID, bool) {
	payload, valid := credentials.VerifySignedValue(
		s.CredentialSubkey("pagination"), purpose, string(key))
	var c cursor
	if !valid || json.Unmarshal(payload, &c) != nil || c.HubUser != hubUser {
		return cursor{}, pgtype.UUID{}, false
	}
	other, err := dbvalue.ParseUUID(c.Other)
	if err != nil {
		return cursor{}, pgtype.UUID{}, false
	}
	return c, other, true
}

// page decodes the cursor of a list request. It writes the problem and
// returns false for a key this user did not get from this list.
func page(
	s *hubruntime.Server, w http.ResponseWriter, r *http.Request,
	purpose string, key *common.PaginationKey, hubUser string,
) (pgtype.Timestamptz, pgtype.UUID, bool) {
	if key == nil {
		return pgtype.Timestamptz{}, pgtype.UUID{}, true
	}
	c, other, ok := verify(s, purpose, *key, hubUser)
	if !ok {
		s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
		return pgtype.Timestamptz{}, pgtype.UUID{}, false
	}
	return dbvalue.Timestamp(c.At), other, true
}

func ListBlocks(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request blocksspec.ListBlockedUsersRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		hubUser := dbvalue.FormatUUID(identity.UserDID)
		before, beforeDID, ok := page(
			s, w, r, blocksPurpose, request.PaginationKey, hubUser)
		if !ok {
			return
		}
		limit := int(request.EffectiveLimit())
		rows, err := s.Queries.ListHubUserBlocks(
			r.Context(), sqlc.ListHubUserBlocksParams{
				BlockerHubUserDid: identity.UserDID,
				BeforeCreatedAt:   before, BeforeBlockedHubUserDid: beforeDID,
				PageLimit: int32(limit + 1),
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "list blocks", err)
			return
		}
		response := blocksspec.ListBlockedUsersResponse{
			Users: []blocksspec.BlockedUser{},
		}
		for index, row := range rows {
			if index == limit {
				last := rows[index-1]
				key, err := sign(s, blocksPurpose, cursor{
					HubUser: hubUser, At: last.CreatedAt.Time.UTC(),
					Other: dbvalue.FormatUUID(last.BlockedHubUserDid),
				})
				if err != nil {
					s.InternalError(r.Context(), w, "sign blocks key", err)
					return
				}
				response.NextPaginationKey = &key
				break
			}
			response.Users = append(response.Users, blocksspec.BlockedUser{
				Handle:    hubspec.HubHandle(row.BlockedHandle),
				CreatedAt: row.CreatedAt.Time.UTC(),
			})
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func ListMutes(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request blocksspec.ListMutedUsersRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		hubUser := dbvalue.FormatUUID(identity.UserDID)
		before, beforeDID, ok := page(
			s, w, r, mutesPurpose, request.PaginationKey, hubUser)
		if !ok {
			return
		}
		limit := int(request.EffectiveLimit())
		rows, err := s.Queries.ListHubUserMutes(
			r.Context(), sqlc.ListHubUserMutesParams{
				MuterHubUserDid: identity.UserDID,
				BeforeCreatedAt: before, BeforeMutedHubUserDid: beforeDID,
				PageLimit: int32(limit + 1),
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "list mutes", err)
			return
		}
		response := blocksspec.ListMutedUsersResponse{
			Users: []blocksspec.MutedUser{},
		}
		for index, row := range rows {
			if index == limit {
				last := rows[index-1]
				key, err := sign(s, mutesPurpose, cursor{
					HubUser: hubUser, At: last.CreatedAt.Time.UTC(),
					Other: dbvalue.FormatUUID(last.MutedHubUserDid),
				})
				if err != nil {
					s.InternalError(r.Context(), w, "sign mutes key", err)
					return
				}
				response.NextPaginationKey = &key
				break
			}
			response.Users = append(response.Users, blocksspec.MutedUser{
				Handle:    hubspec.HubHandle(row.MutedHandle),
				CreatedAt: row.CreatedAt.Time.UTC(),
			})
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}
