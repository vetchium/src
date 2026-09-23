package hub

import "github.com/vetchium/src/typespec/problem"

var OperationNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/hub-operation-not-found",
	Title:  "Hub operation not found",
	Status: 404,
	Detail: "The requested operation was not found",
}
