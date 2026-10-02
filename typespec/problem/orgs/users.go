package orgs

import "github.com/vetchium/src/typespec/problem"

// UserLimitReachedDetails is the Go companion of TypeSpec's
// OrgUserLimitReachedDetails: Details plus the seat cap.
type UserLimitReachedDetails struct {
	problem.Details
	Limit int32 `json:"limit"`
}

func UserLimitReachedError(limit int32) UserLimitReachedDetails {
	return UserLimitReachedDetails{
		Details: problem.Details{
			Type:   "vetchium-problem-details/org-user-limit-reached",
			Title:  "Org user limit reached",
			Status: 409,
			Detail: "The Org has no free seat under its plan",
		},
		Limit: limit,
	}
}

var InvitationInvalidError = problem.Details{
	Type:   "vetchium-problem-details/org-invitation-invalid",
	Title:  "Invalid Org invitation",
	Status: 401,
	Detail: "Invitation token is invalid, expired, consumed, or cancelled",
}

var InvitationNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/org-invitation-not-found",
	Title:  "Org invitation not found",
	Status: 404,
	Detail: "No pending invitation exists for an address in the request",
}

var UserAlreadyExistsError = problem.Details{
	Type:   "vetchium-problem-details/org-user-already-exists",
	Title:  "Org user already exists",
	Status: 409,
	Detail: "An Org user already exists for the invited address",
}
