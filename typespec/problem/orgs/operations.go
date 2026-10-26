package orgs

import "github.com/vetchium/src/typespec/problem"

var OperationNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/org-operation-not-found",
	Title:  "Org operation not found",
	Status: 404,
	Detail: "The requested operation was not found",
}
