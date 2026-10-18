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
