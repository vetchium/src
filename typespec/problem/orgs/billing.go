package orgs

import (
	"github.com/vetchium/src/typespec/orgs/subscriptions"
	"github.com/vetchium/src/typespec/problem"
)

var PlanNotOfferedError = problem.Details{
	Type:   "vetchium-problem-details/org-plan-not-offered",
	Title:  "Org plan not offered",
	Status: 403,
	Detail: "This tenant does not offer that Org plan",
}

// PlanRequiredDetails is the Go companion of TypeSpec's
// OrgPlanRequiredDetails: Details plus the plan the operation requires.
type PlanRequiredDetails struct {
	problem.Details
	PlanOID subscriptions.PlanOID `json:"plan_oid"`
}

func PlanRequiredError(required subscriptions.Plan) PlanRequiredDetails {
	return PlanRequiredDetails{
		Details: problem.Details{
			Type:   "vetchium-problem-details/org-plan-required",
			Title:  "Org plan required",
			Status: 403,
			Detail: "This operation requires a higher Org plan",
		},
		PlanOID: subscriptions.PlanOID(required),
	}
}

var BillingPastDueError = problem.Details{
	Type:   "vetchium-problem-details/org-billing-past-due",
	Title:  "Org billing past due",
	Status: 409,
	Detail: "The plan cannot be changed while an invoice is unpaid. " +
		"Pay the open invoice first.",
}

var PaymentMethodRequiredError = problem.Details{
	Type:   "vetchium-problem-details/org-payment-method-required",
	Title:  "Org payment method required",
	Status: 409,
	Detail: "Save a payment method before this charge",
}

var PaymentDeclinedError = problem.Details{
	Type:   "vetchium-problem-details/org-payment-declined",
	Title:  "Org payment declined",
	Status: 402,
	Detail: "The saved payment method was declined. Nothing was changed.",
}

var InvoiceNotOpenError = problem.Details{
	Type:   "vetchium-problem-details/org-invoice-not-open",
	Title:  "Org invoice not open",
	Status: 409,
	Detail: "The invoice is not open for payment",
}

// UserLimitExceedsTargetDetails is the Go companion of TypeSpec's
// OrgUserLimitExceedsTargetDetails.
type UserLimitExceedsTargetDetails struct {
	problem.Details
	Limit      int32 `json:"limit"`
	SeatsInUse int32 `json:"seats_in_use"`
}

func UserLimitExceedsTargetError(limit, seatsInUse int32) UserLimitExceedsTargetDetails {
	return UserLimitExceedsTargetDetails{
		Details: problem.Details{
			Type:   "vetchium-problem-details/org-user-limit-exceeds-target",
			Title:  "Org users exceed the target limit",
			Status: 409,
			Detail: "The Org has more users than the requested configuration " +
				"allows. Remove users or cancel invitations first.",
		},
		Limit:      limit,
		SeatsInUse: seatsInUse,
	}
}
