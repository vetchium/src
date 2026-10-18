package ai

import (
	"net/http"

	aispec "github.com/vetchium/src/typespec/orgs/ai"
	"github.com/vetchium/src/typespec/orgs/authorization"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	orgai "backend/internal/orgs/ai"
)

// GetAIOptions tells a caller about to run an operation what it may use. The
// required permission depends on the operation, so it is checked here.
func GetAIOptions(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request aispec.GetAIOptionsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		permission, known := orgai.OperationPermission(request.Operation)
		if !known || !authorization.Holds(
			effective(identity), permission,
		) {
			s.Problem(r.Context(), w, orgsproblem.PermissionRequiredError)
			return
		}
		if s.AI == nil {
			s.Problem(r.Context(), w, orgsproblem.AIUnavailableError)
			return
		}
		standing, _, err := standing(r.Context(), s.Queries, identity.OrgDID)
		if err != nil {
			s.InternalError(r.Context(), w, "read AI standing", err)
			return
		}
		rows, err := s.Queries.ListOrgAIPolicies(r.Context(), identity.OrgDID)
		if err != nil {
			s.InternalError(r.Context(), w, "list AI policies", err)
			return
		}
		policy := storedPolicies(rows)[request.Operation]
		models, defaultModel := s.AI.Effective(
			request.Operation, policy, s.CurrentTime(),
		)
		response := aispec.AIOptions{
			Availability:     availability(standing, policy),
			Models:           make([]aispec.AIModel, 0, len(models)),
			DefaultModel:     defaultModel,
			BalanceAvailable: standing.Balance.Available,
		}
		for _, model := range models {
			response.Models = append(response.Models, orgai.ModelView(model))
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

// availability ranks an operation turned off below AI being off for the Org
// and above the plan and credit checks, which it makes moot.
func availability(
	standing orgai.Standing, policy *orgai.Policy,
) aispec.AIAvailability {
	current := standing.Availability()
	if current != aispec.NotEnabled && policy.Off() {
		return aispec.OperationOff
	}
	return current
}

func effective(identity middleware.OrgIdentity) []authorization.OrgPermissionID {
	permissions := make(
		[]authorization.OrgPermissionID, 0, len(identity.Permissions),
	)
	for _, permission := range identity.Permissions {
		permissions = append(
			permissions, authorization.OrgPermissionID(permission),
		)
	}
	return permissions
}
