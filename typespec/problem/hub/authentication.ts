import type { Details } from "../details.ts";

export const InvalidCredentialsError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-invalid-credentials",
  title: "Invalid Hub credentials",
  status: 401,
  detail: "The supplied credentials are invalid",
};

export const IncorrectPasswordError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-incorrect-password",
  title: "Incorrect password",
  status: 422,
  detail: "The password did not verify for the authenticated Hub user",
};

export const HubUserDisabledError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-user-disabled",
  title: "Hub user disabled",
  status: 403,
  detail: "The Hub user is disabled",
};

export const AuthenticationRequiredError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-authentication-required",
  title: "Hub authentication required",
  status: 401,
  detail: "A valid Hub bearer session is required",
};

export const RecentAuthenticationRequiredError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-recent-authentication-required",
  title: "Recent authentication required",
  status: 401,
  detail:
    "Full authentication must have completed within the preceding five minutes",
};

export const InvalidLoginChallengeError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-invalid-login-challenge",
  title: "Invalid Hub login challenge",
  status: 401,
  detail: "Login challenge is invalid, expired, or consumed",
};

export const IncorrectTOTPCodeError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-incorrect-totp-code",
  title: "Incorrect TOTP code",
  status: 422,
  detail: "The TOTP code did not verify",
};

export const InvalidPasswordResetTokenError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-invalid-password-reset-token",
  title: "Invalid password reset token",
  status: 401,
  detail:
    "Password reset token is invalid, expired, consumed, or no longer eligible",
};
