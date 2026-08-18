package admin

import "github.com/vetchium/src/typespec/problem"

var AdminUserNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/admin-user-not-found",
	Title:  "Admin user not found",
	Status: 404,
	Detail: "The requested admin user does not exist",
}

var CannotDisableCurrentAdminError = problem.Details{
	Type:   "vetchium-problem-details/cannot-disable-current-admin",
	Title:  "Cannot disable current admin",
	Status: 409,
	Detail: "An admin cannot disable their own account",
}

var AdminUserAlreadyExistsError = problem.Details{
	Type:   "vetchium-problem-details/admin-user-already-exists",
	Title:  "Admin user already exists",
	Status: 409,
	Detail: "An admin user already exists for the normalized email address",
}

var AdminInvitationAlreadyPendingError = problem.Details{
	Type:   "vetchium-problem-details/admin-invitation-already-pending",
	Title:  "Admin invitation already pending",
	Status: 409,
	Detail: "A non-expired invitation already exists for the normalized " +
		"email address",
}

var LastAdminManagerError = problem.Details{
	Type:   "vetchium-problem-details/last-admin-manager",
	Title:  "Last admin manager",
	Status: 409,
	Detail: "At least one active admin must keep admin:manage_users",
}
