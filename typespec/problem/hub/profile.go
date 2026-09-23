package hub

import "github.com/vetchium/src/typespec/problem"

var ProfileNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/hub-profile-not-found",
	Title:  "Hub profile not found",
	Status: 404,
	Detail: "The requested Hub profile was not found",
}

var ProfileUnavailableError = problem.Details{
	Type:   "vetchium-problem-details/hub-profile-unavailable",
	Title:  "Hub profile unavailable",
	Status: 503,
	Detail: "The requested Hub profile is temporarily unavailable",
}

var ProfileConflictError = problem.Details{
	Type:   "vetchium-problem-details/hub-profile-conflict",
	Title:  "Hub profile conflict",
	Status: 409,
	Detail: "The profile change conflicts with the current state",
}

var ProfessionalEmailCodeRejectedError = problem.Details{
	Type:   "vetchium-problem-details/hub-professional-email-code-rejected",
	Title:  "Professional email code rejected",
	Status: 400,
	Detail: "The verification code could not be accepted",
}

var ProfilePictureTooLargeError = problem.Details{
	Type:   "vetchium-problem-details/hub-profile-picture-too-large",
	Title:  "Profile picture too large",
	Status: 413,
	Detail: "The profile picture exceeds the eight-megabyte limit",
}

var ProfilePictureInvalidError = problem.Details{
	Type:   "vetchium-problem-details/hub-profile-picture-invalid",
	Title:  "Invalid profile picture",
	Status: 400,
	Detail: "The image format or dimensions are not supported",
}
