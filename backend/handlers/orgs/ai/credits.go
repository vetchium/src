package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/vetchium/src/typespec/common"
	aispec "github.com/vetchium/src/typespec/orgs/ai"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	orgai "backend/internal/orgs/ai"
	orgsauthn "backend/internal/orgs/auth"
)

const lotsPaginationPurpose = "orgs:ai-credit-lots"

func creditsResponse(
	s *orgsruntime.Server, q sqlc.Querier, r *http.Request,
	identity middleware.OrgIdentity,
) (aispec.AICreditsResponse, error) {
	state, err := q.GetOrgAIState(r.Context(), identity.OrgDID)
	if err != nil {
		return aispec.AICreditsResponse{}, err
	}
	current, err := balance(r.Context(), q, identity.OrgDID)
	if err != nil {
		return aispec.AICreditsResponse{}, err
	}
	plan := subscriptionspec.Plan(state.OrgPlanOid)
	response := aispec.AICreditsResponse{
		Balance:         current,
		MonthlyGrant:    subscriptionspec.AICreditsPerMonth(plan),
		PurchaseAllowed: subscriptionspec.AllowsAI(plan),
		Packs:           make([]aispec.AICreditPack, 0, len(s.AI.Config.CreditPacks)),
	}
	for _, pack := range s.AI.Config.CreditPacks {
		response.Packs = append(response.Packs, aispec.AICreditPack{
			PackID: pack.ID, Credits: pack.Credits,
			PriceCurrency:    pack.PriceCurrency,
			PriceAmountMinor: pack.PriceAmountMinor,
		})
	}
	return response, nil
}

func GetAICredits(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.AI == nil {
			s.Problem(r.Context(), w, orgsproblem.AIUnavailableError)
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		response, err := creditsResponse(s, s.Queries, r, identity)
		if errors.Is(err, pgx.ErrNoRows) {
			s.AuthenticationProblem(
				r.Context(), w, orgsproblem.AuthenticationRequiredError,
				orgsauthn.BearerChallenge,
			)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get AI credits", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

// BuyAICreditPack grants a pack at once. Payment is simulated until a payment
// provider is integrated.
func BuyAICreditPack(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request aispec.BuyAICreditPackRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type body = aispec.AICreditsResponse
		type result = handlerauth.Result[body]
		handlerauth.RunIdempotent(s, w, r, "orgs:buy-ai-credit-pack",
			dbvalue.FormatUUID(identity.UserID), key, request,
			now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				ctx := r.Context()
				if s.AI == nil {
					return handlerauth.Failure[body](orgsproblem.AIUnavailableError)
				}
				pack, offered := s.AI.Config.Pack(request.PackID)
				if !offered {
					return handlerauth.Failure[body](orgsproblem.AIPackNotOfferedError)
				}
				lotID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				if err := q.LockOrgAICredits(ctx, identity.OrgDID); err != nil {
					return result{}, nil, err
				}
				bought, err := q.BuyOrgAICreditPack(ctx, sqlc.BuyOrgAICreditPackParams{
					LotID: lotID, PackID: dbvalue.Text(string(pack.ID)),
					ActorOrgUserID: identity.UserID, Credits: pack.Credits,
					OrgDid: identity.OrgDID, AiPlanOids: orgai.AIPlanOIDs(),
					TenantID: s.TenantID, IdempotencyKey: dbvalue.Text(string(key)),
					PriceCurrency:    string(pack.PriceCurrency),
					PriceAmountMinor: pack.PriceAmountMinor,
				})
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Failure[body](
						orgsproblem.PlanRequiredError(subscriptionspec.GoldTier),
					)
				}
				if err != nil {
					return result{}, nil, err
				}
				if bought.AuditCount != 1 {
					return result{}, nil, fmt.Errorf("unaudited AI credit purchase")
				}
				response, err := creditsResponse(s, q, r, identity)
				if err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusOK, Body: response}, nil, nil
			})
	}
}

type lotCursor struct {
	AfterCreatedAt time.Time `json:"after_created_at"`
	AfterLotID     string    `json:"after_lot_id"`
}

func ListAICreditLots(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request aispec.ListAICreditLotsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		limit := int(request.EffectiveLimit())
		params := sqlc.ListOrgAICreditLotsParams{
			OrgDid: identity.OrgDID, PageLimit: int32(limit) + 1,
		}
		if request.PaginationKey != nil {
			payload, valid := credentials.VerifySignedValue(
				s.CredentialSubkey("pagination"), lotsPaginationPurpose,
				string(*request.PaginationKey),
			)
			var cursor lotCursor
			if !valid || json.Unmarshal(payload, &cursor) != nil ||
				cursor.AfterCreatedAt.IsZero() {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			id, err := dbvalue.ParseUUID(cursor.AfterLotID)
			if err != nil {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			params.AfterCreatedAt = dbvalue.Timestamp(cursor.AfterCreatedAt)
			params.AfterLotID = id
		}
		rows, err := s.Queries.ListOrgAICreditLots(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "list AI credit lots", err)
			return
		}
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}
		response := aispec.ListAICreditLotsResponse{
			Lots: make([]aispec.AICreditLot, 0, len(rows)),
		}
		for _, row := range rows {
			lot := aispec.AICreditLot{
				Kind:             aispec.AICreditLotKind(row.Kind),
				CreditsGranted:   row.CreditsGranted,
				CreditsRemaining: row.CreditsRemaining,
				CreatedAt:        row.CreatedAt.Time.UTC(),
				ExpiresAt:        row.ExpiresAt.Time.UTC(),
			}
			if row.PackID.Valid {
				pack := aispec.AICreditPackID(row.PackID.String)
				lot.PackID = &pack
			}
			response.Lots = append(response.Lots, lot)
		}
		if hasMore {
			last := rows[len(rows)-1]
			payload, err := json.Marshal(lotCursor{
				AfterCreatedAt: last.CreatedAt.Time.UTC(),
				AfterLotID:     dbvalue.FormatUUID(last.LotID),
			})
			if err != nil {
				s.InternalError(r.Context(), w, "encode AI credit lot cursor", err)
				return
			}
			key := common.PaginationKey(credentials.SignValue(
				s.CredentialSubkey("pagination"), lotsPaginationPurpose, payload,
			))
			response.NextPaginationKey = &key
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}
