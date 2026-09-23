import type { Details } from "../details.ts";

export const ProfileNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-profile-not-found",
  title: "Hub profile not found",
  status: 404,
  detail: "The requested Hub profile was not found",
};

export const ProfileUnavailableError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-profile-unavailable",
  title: "Hub profile unavailable",
  status: 503,
  detail: "The requested Hub profile is temporarily unavailable",
};

export const ProfileConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-profile-conflict",
  title: "Hub profile conflict",
  status: 409,
  detail: "The profile change conflicts with the current state",
};

export const ProfessionalEmailCodeRejectedError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-professional-email-code-rejected",
  title: "Professional email code rejected",
  status: 400,
  detail: "The verification code could not be accepted",
};

export const ProfilePictureTooLargeError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-profile-picture-too-large",
  title: "Profile picture too large",
  status: 413,
  detail: "The profile picture exceeds the eight-megabyte limit",
};

export const ProfilePictureInvalidError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-profile-picture-invalid",
  title: "Invalid profile picture",
  status: 400,
  detail: "The image format or dimensions are not supported",
};
