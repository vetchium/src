// Package ai holds the Orgs API handlers for AI assistance.
package ai

import (
	"context"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	aispec "github.com/vetchium/src/typespec/orgs/ai"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	orgsruntime "backend/internal/orgs"
	orgai "backend/internal/orgs/ai"
)

// standing reads what decides whether the Org may run AI now.
func standing(
	ctx context.Context, q sqlc.Querier, orgDID pgtype.UUID,
) (orgai.Standing, sqlc.GetOrgAIStateRow, error) {
	state, err := q.GetOrgAIState(ctx, orgDID)
	if err != nil {
		return orgai.Standing{}, sqlc.GetOrgAIStateRow{}, err
	}
	balance, err := balance(ctx, q, orgDID)
	if err != nil {
		return orgai.Standing{}, sqlc.GetOrgAIStateRow{}, err
	}
	return orgai.Standing{
		Enabled: state.Enabled,
		TermsCurrent: state.AcceptedTermsVersion.Valid &&
			state.AcceptedTermsVersion.String == aispec.OrgAITermsVersion,
		PlanAllowsAI: subscriptionspec.AllowsAI(
			subscriptionspec.Plan(state.OrgPlanOid),
		),
		Balance: balance,
	}, state, nil
}

func balance(
	ctx context.Context, q sqlc.Querier, orgDID pgtype.UUID,
) (aispec.AICreditBalance, error) {
	row, err := q.GetOrgAICreditBalance(ctx, sqlc.GetOrgAICreditBalanceParams{
		OrgDid: orgDID, AiPlanOids: orgai.AIPlanOIDs(),
	})
	if err != nil {
		return aispec.AICreditBalance{}, err
	}
	return orgai.Balance(
		row.GrantRemaining, row.PurchasedRemaining, row.Reserved,
		dbvalue.TimePtr(row.GrantExpiresAt),
	), nil
}

func storedPolicies(
	rows []sqlc.ListOrgAIPoliciesRow,
) map[aispec.AIOperation]*orgai.Policy {
	policies := make(map[aispec.AIOperation]*orgai.Policy, len(rows))
	for _, row := range rows {
		allowed := make([]aispec.AIModelOID, 0, len(row.AllowedModels))
		for _, model := range row.AllowedModels {
			allowed = append(allowed, aispec.AIModelOID(model))
		}
		policies[aispec.AIOperation(row.Operation)] = &orgai.Policy{
			AllowedModels: allowed,
			DefaultModel:  aispec.AIModelOID(row.DefaultModel),
		}
	}
	return policies
}

func settingsResponse(
	s *orgsruntime.Server, state sqlc.GetOrgAIStateRow,
	rows []sqlc.ListOrgAIPoliciesRow, now time.Time,
) aispec.AISettingsResponse {
	response := aispec.AISettingsResponse{
		Settings: aispec.OrgAISettings{
			Enabled:  state.Enabled,
			Policies: make([]aispec.AIOperationPolicy, 0, len(rows)),
		},
		Models:              []aispec.AIModel{},
		OperationDefaults:   []aispec.AIOperationDefault{},
		CurrentTermsVersion: aispec.OrgAITermsVersion,
		PlanAllowsAI: subscriptionspec.AllowsAI(
			subscriptionspec.Plan(state.OrgPlanOid),
		),
		UnavailableModels: []aispec.AIModelOID{},
	}
	if state.AcceptedTermsVersion.Valid {
		version := state.AcceptedTermsVersion.String
		response.Settings.AcceptedTermsVersion = &version
		response.Settings.AcceptedTermsAt = dbvalue.TimePtr(state.AcceptedTermsAt)
	}
	for _, model := range s.AI.Offered(now) {
		response.Models = append(response.Models, orgai.ModelView(model))
	}
	for _, operation := range aispec.Operations() {
		response.OperationDefaults = append(response.OperationDefaults,
			aispec.AIOperationDefault{
				Operation:    aispec.AIOperationOID(operation),
				DefaultModel: s.AI.Config.OperationDefaults[operation],
			})
	}
	for _, row := range rows {
		policy := aispec.AIOperationPolicy{
			Operation:     aispec.AIOperationOID(row.Operation),
			AllowedModels: make([]aispec.AIModelOID, 0, len(row.AllowedModels)),
			DefaultModel:  aispec.AIModelOID(row.DefaultModel),
		}
		for _, model := range row.AllowedModels {
			oid := aispec.AIModelOID(model)
			policy.AllowedModels = append(policy.AllowedModels, oid)
			if _, offered := s.AI.OfferedModel(oid, now); !offered &&
				!slices.Contains(response.UnavailableModels, oid) {
				response.UnavailableModels = append(
					response.UnavailableModels, oid,
				)
			}
		}
		response.Settings.Policies = append(response.Settings.Policies, policy)
	}
	return response
}
