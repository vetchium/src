import "../details.tsp";

namespace Vetchium.Problem;

const HubProfileNotFoundError = #{
  type: "vetchium-problem-details/hub-profile-not-found",
  title: "Hub profile not found",
  status: 404,
  detail: "The requested Hub profile was not found",
};
alias HubProfileNotFoundErrorResponse = Response<
  404,
  typeof HubProfileNotFoundError
>;

const HubProfileUnavailableError = #{
  type: "vetchium-problem-details/hub-profile-unavailable",
  title: "Hub profile unavailable",
  status: 503,
  detail: "The requested Hub profile is temporarily unavailable",
};
alias HubProfileUnavailableErrorResponse = Response<
  503,
  typeof HubProfileUnavailableError
>;

const HubProfileConflictError = #{
  type: "vetchium-problem-details/hub-profile-conflict",
  title: "Hub profile conflict",
  status: 409,
  detail: "The profile change conflicts with the current state",
};
alias HubProfileConflictErrorResponse = Response<
  409,
  typeof HubProfileConflictError
>;

const HubProfessionalEmailCodeRejectedError = #{
  type: "vetchium-problem-details/hub-professional-email-code-rejected",
  title: "Professional email code rejected",
  status: 400,
  detail: "The verification code could not be accepted",
};
alias HubProfessionalEmailCodeRejectedErrorResponse = Response<
  400,
  typeof HubProfessionalEmailCodeRejectedError
>;

const HubProfilePictureTooLargeError = #{
  type: "vetchium-problem-details/hub-profile-picture-too-large",
  title: "Profile picture too large",
  status: 413,
  detail: "The profile picture exceeds the eight-megabyte limit",
};
alias HubProfilePictureTooLargeErrorResponse = Response<
  413,
  typeof HubProfilePictureTooLargeError
>;

const HubProfilePictureInvalidError = #{
  type: "vetchium-problem-details/hub-profile-picture-invalid",
  title: "Invalid profile picture",
  status: 400,
  detail: "The image format or dimensions are not supported",
};
alias HubProfilePictureInvalidErrorResponse = Response<
  400,
  typeof HubProfilePictureInvalidError
>;
