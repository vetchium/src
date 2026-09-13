package hub

import (
	"github.com/vetchium/src/typespec/hub/subscriptions"
	"github.com/vetchium/src/typespec/problem"
)

var PlanNotOfferedError = problem.Details{
	Type:   "vetchium-problem-details/hub-plan-not-offered",
	Title:  "Hub plan not offered",
	Status: 403,
	Detail: "This tenant does not offer that Hub plan",
}

// PlanRequiredDetails is the Go companion of TypeSpec's
// HubPlanRequiredDetails: Details plus required_plan_oid, the same
// extension-member shape TypeSpec's ValidationFailedDetails uses for fields.
type PlanRequiredDetails struct {
	problem.Details
	RequiredPlanOID subscriptions.PlanOID `json:"required_plan_oid"`
}

func PlanRequiredError(required subscriptions.Plan) PlanRequiredDetails {
	return PlanRequiredDetails{
		Details: problem.Details{
			Type:   "vetchium-problem-details/hub-plan-required",
			Title:  "Hub plan required",
			Status: 403,
			Detail: "This operation requires a higher Hub plan",
		},
		RequiredPlanOID: subscriptions.PlanOID(required),
	}
}
