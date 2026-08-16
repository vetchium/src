package admin

import "github.com/vetchium/src/typespec/problem"

var AdminPermissionRequiredError = problem.Details{
	Type:   "vetchium-problem-details/admin-permission-required",
	Title:  "Admin permission required",
	Status: 403,
	Detail: "The authenticated admin lacks the required permission",
}
