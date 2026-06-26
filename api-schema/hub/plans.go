package hub

import (
	"errors"
	"slices"

	"vetchium-api-server.typespec/common"
)

// HubPlanId is the hub plan identifier enum (Spec 17). Never a bare string.
type HubPlanId string

const (
	HubPlanIdFree HubPlanId = "free"
	HubPlanIdPro  HubPlanId = "pro"
)

var validHubPlanIDs = []HubPlanId{HubPlanIdFree, HubPlanIdPro}

// IsValidHubPlanID reports whether id is one of the currently shipped hub plan
// identifiers. Note: the switch-plan handler deliberately does NOT reject
// unknown ids at validation time — it lets the DB lookup decide (404 if the
// plan does not exist, 422 if it exists but is retired / not self-upgradeable),
// per Spec 17 §9.4. This helper is exported for callers that need a strict check.
func IsValidHubPlanID(id HubPlanId) bool {
	return slices.Contains(validHubPlanIDs, id)
}

var errPlanIDRequired = errors.New("plan_id is required")

// HubPlan is a hub plan capability definition. Pricing lives in frontend config.
type HubPlan struct {
	PlanID                  HubPlanId `json:"plan_id"`
	DisplayOrder            int32     `json:"display_order"`
	CanUploadProfilePicture bool      `json:"can_upload_profile_picture"`
	CanPostMessages         bool      `json:"can_post_messages"`
	SelfUpgradeable         bool      `json:"self_upgradeable"`
}

// ListHubPlansRequest is the request to list active hub plans.
type ListHubPlansRequest struct{}

func (r ListHubPlansRequest) Validate() []common.ValidationError { return nil }

// ListHubPlansResponse wraps the active hub plan catalog.
type ListHubPlansResponse struct {
	Plans []HubPlan `json:"plans"`
}

// SwitchHubPlanRequest switches the caller's own plan.
type SwitchHubPlanRequest struct {
	PlanID HubPlanId `json:"plan_id"`
}

func (r SwitchHubPlanRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	// Only reject an empty plan_id (400). An unknown-but-non-empty id is left to
	// the handler's DB lookup → 404 (missing) or 422 (retired/non-self-upgradeable).
	if r.PlanID == "" {
		errs = append(errs, common.NewValidationError("plan_id", errPlanIDRequired))
	}
	return errs
}

// HubPlanResponse is the caller's plan after a switch.
type HubPlanResponse struct {
	PlanID                  HubPlanId `json:"plan_id"`
	CanUploadProfilePicture bool      `json:"can_upload_profile_picture"`
	CanPostMessages         bool      `json:"can_post_messages"`
}
