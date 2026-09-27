import type { Details } from "../details.ts";

export const InvalidCredentialsError: Readonly<Details> = {
  type: "vetchium-problem-details/org-invalid-credentials",
  title: "Invalid Org credentials",
  status: 401,
  detail: "The supplied credentials are invalid",
};

export const IncorrectPasswordError: Readonly<Details> = {
  type: "vetchium-problem-details/org-incorrect-password",
  title: "Incorrect password",
  status: 422,
  detail: "The password did not verify for the authenticated Org user",
};

export const OrgUserDisabledError: Readonly<Details> = {
  type: "vetchium-problem-details/org-user-disabled",
  title: "Org user disabled",
  status: 403,
  detail: "The Org user is disabled",
};

export const AuthenticationRequiredError: Readonly<Details> = {
  type: "vetchium-problem-details/org-authentication-required",
  title: "Org authentication required",
  status: 401,
  detail: "A valid Org bearer session is required",
};

export const InvalidLoginChallengeError: Readonly<Details> = {
  type: "vetchium-problem-details/org-invalid-login-challenge",
  title: "Invalid Org login challenge",
  status: 401,
  detail: "Login challenge is invalid, expired, or consumed",
};

export const IncorrectTOTPCodeError: Readonly<Details> = {
  type: "vetchium-problem-details/org-incorrect-totp-code",
  title: "Incorrect TOTP code",
  status: 422,
  detail: "The TOTP code did not verify",
};

export const InvalidPasswordResetTokenError: Readonly<Details> = {
  type: "vetchium-problem-details/org-invalid-password-reset-token",
  title: "Invalid password reset token",
  status: 401,
  detail:
    "Password reset token is invalid, expired, consumed, or no longer eligible",
};

export const PermissionRequiredError: Readonly<Details> = {
  type: "vetchium-problem-details/org-permission-required",
  title: "Org permission required",
  status: 403,
  detail: "The Org user lacks the permission this operation requires",
};

export const RecentAuthenticationRequiredError: Readonly<Details> = {
  type: "vetchium-problem-details/org-recent-authentication-required",
  title: "Recent authentication required",
  status: 401,
  detail:
    "Full authentication must have completed within the preceding five minutes",
};

export const OrgHomedElsewhereErrorType =
  "vetchium-problem-details/org-homed-elsewhere";

export interface HomedElsewhereDetails extends Details {
  type: typeof OrgHomedElsewhereErrorType;
  tenant_id: string;
  orgs_url: string;
}

export function isHomedElsewhereProblem(
  value: unknown,
): value is HomedElsewhereDetails {
  if (typeof value !== "object" || value === null) return false;
  const problem = value as Record<string, unknown>;
  return (
    problem.type === OrgHomedElsewhereErrorType &&
    typeof problem.tenant_id === "string" &&
    typeof problem.orgs_url === "string"
  );
}
