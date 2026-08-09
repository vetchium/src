import type { Details } from "../details.ts";

export const InvalidCredentialsError: Readonly<Details> = {
  type: "vetchium-problem-details/invalid-credentials",
  title: "Invalid credentials",
  status: 401,
  detail: "The supplied credentials are invalid",
};

export const AdminUserDisabledError: Readonly<Details> = {
  type: "vetchium-problem-details/admin-user-disabled",
  title: "Admin user disabled",
  status: 403,
  detail: "The authenticated admin user is disabled",
};

export const AdminAuthenticationRequiredError: Readonly<Details> = {
  type: "vetchium-problem-details/admin-authentication-required",
  title: "Admin authentication required",
  status: 401,
  detail: "A valid admin bearer session is required",
};

export const RecentAuthenticationRequiredError: Readonly<Details> = {
  type: "vetchium-problem-details/recent-authentication-required",
  title: "Recent authentication required",
  status: 401,
  detail:
    "Full authentication must have completed within the preceding five minutes",
};

export const InvalidLoginChallengeError: Readonly<Details> = {
  type: "vetchium-problem-details/invalid-login-challenge",
  title: "Invalid login challenge",
  status: 401,
  detail: "Login challenge is invalid, expired, or consumed",
};

export const IncorrectTOTPCodeError: Readonly<Details> = {
  type: "vetchium-problem-details/incorrect-totp-code",
  title: "Incorrect TOTP code",
  status: 422,
  detail: "The TOTP code did not verify",
};

export const InvalidInvitationTokenError: Readonly<Details> = {
  type: "vetchium-problem-details/invalid-invitation-token",
  title: "Invalid invitation token",
  status: 401,
  detail: "Invitation token is invalid, expired, or consumed",
};

export const InvalidPasswordResetTokenError: Readonly<Details> = {
  type: "vetchium-problem-details/invalid-password-reset-token",
  title: "Invalid password reset token",
  status: 401,
  detail:
    "Password reset token is invalid, expired, consumed, or no longer eligible",
};
