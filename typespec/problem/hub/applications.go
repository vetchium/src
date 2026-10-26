package hub

import "github.com/vetchium/src/typespec/problem"

var ApplicationExistsError = problem.Details{
	Type:   "vetchium-problem-details/hub-application-exists",
	Title:  "Application exists",
	Status: 409,
	Detail: "The applicant already applied to this Opening",
}

var OpeningNotAcceptingError = problem.Details{
	Type:   "vetchium-problem-details/hub-opening-not-accepting",
	Title:  "Opening not accepting applications",
	Status: 409,
	Detail: "The Opening is not accepting applications",
}

var ApplicationNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/hub-application-not-found",
	Title:  "Application not found",
	Status: 404,
	Detail: "The requested application was not found",
}

var ApplicationStateConflictError = problem.Details{
	Type:   "vetchium-problem-details/hub-application-state-conflict",
	Title:  "Application state conflict",
	Status: 409,
	Detail: "The application's current state does not allow this action",
}

var ReferralAgencyNotEligibleError = problem.Details{
	Type:   "vetchium-problem-details/hub-referral-agency-not-eligible",
	Title:  "Referral agency not eligible",
	Status: 422,
	Detail: "The named domain is not the primary domain of an agency assigned to the Opening",
}
