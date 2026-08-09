package admin

import "github.com/vetchium/src/typespec/problem"

var AdminPermissionRequiredError = problem.Details{
	Type:   "vetchium-problem-details/admin-permission-required",
	Title:  "Admin permission required",
	Status: 403,
	Detail: "The authenticated admin lacks the required permission",
}

var SuperadminRequiredError = problem.Details{
	Type:   "vetchium-problem-details/superadmin-required",
	Title:  "Superadmin required",
	Status: 403,
	Detail: "The operation requires an authenticated superadmin",
}

var PermissionDependencyConflictError = problem.Details{
	Type:   "vetchium-problem-details/permission-dependency-conflict",
	Title:  "Permission dependency conflict",
	Status: 409,
	Detail: "The permission cannot be revoked while another assigned " +
		"permission depends on it",
}

var PermissionNotApplicableError = problem.Details{
	Type:   "vetchium-problem-details/permission-not-applicable",
	Title:  "Permission not applicable",
	Status: 409,
	Detail: "Direct permissions are not applicable to a superadmin",
}

var CannotDemoteCurrentSuperadminError = problem.Details{
	Type:   "vetchium-problem-details/cannot-demote-current-superadmin",
	Title:  "Cannot demote current superadmin",
	Status: 409,
	Detail: "A superadmin cannot demote their own account",
}
