import "../details.tsp";

namespace Vetchium.Problem;

const InvalidCredentialsError = #{
  type: "vetchium-problem-details/invalid-credentials",
  title: "Invalid credentials",
  status: 401,
  detail: "The supplied credentials are invalid",
};

alias InvalidCredentialsErrorResponse = AuthenticationResponse<
  "VetchiumAdminLogin realm=\"admin\"",
  typeof InvalidCredentialsError
>;

const AdminUserDisabledError = #{
  type: "vetchium-problem-details/admin-user-disabled",
  title: "Admin user disabled",
  status: 403,
  detail: "The authenticated admin user is disabled",
};

alias AdminUserDisabledErrorResponse = Response<
  403,
  typeof AdminUserDisabledError
>;

const AdminAuthenticationRequiredError = #{
  type: "vetchium-problem-details/admin-authentication-required",
  title: "Admin authentication required",
  status: 401,
  detail: "A valid admin bearer session is required",
};

alias AdminAuthenticationRequiredErrorResponse = AuthenticationResponse<
  "Bearer realm=\"admin\"",
  typeof AdminAuthenticationRequiredError
>;

const RecentAuthenticationRequiredError = #{
  type: "vetchium-problem-details/recent-authentication-required",
  title: "Recent authentication required",
  status: 401,
  detail: "Full authentication must have completed within the preceding five minutes",
};

alias RecentAuthenticationRequiredErrorResponse = AuthenticationResponse<
  "Bearer realm=\"admin\", auth_time=\"recent\"",
  typeof RecentAuthenticationRequiredError
>;

/** Authentication failures for operations that require a recent session. */
union AdminAuthenticationOrRecentRequiredErrorBody {
  authenticationRequired: typeof AdminAuthenticationRequiredError,
  recentAuthenticationRequired: typeof RecentAuthenticationRequiredError,
}

alias AdminAuthenticationOrRecentRequiredErrorResponse = AuthenticationResponse<
  "Bearer realm=\"admin\"",
  AdminAuthenticationOrRecentRequiredErrorBody
>;

const InvalidLoginChallengeError = #{
  type: "vetchium-problem-details/invalid-login-challenge",
  title: "Invalid login challenge",
  status: 401,
  detail: "Login challenge is invalid, expired, or consumed",
};

alias InvalidLoginChallengeErrorResponse = AuthenticationResponse<
  "VetchiumAdminLoginChallenge realm=\"admin\"",
  typeof InvalidLoginChallengeError
>;

const IncorrectTOTPCodeError = #{
  type: "vetchium-problem-details/incorrect-totp-code",
  title: "Incorrect TOTP code",
  status: 422,
  detail: "The TOTP code did not verify",
};

alias IncorrectTOTPCodeErrorResponse = Response<
  422,
  typeof IncorrectTOTPCodeError
>;

const InvalidInvitationTokenError = #{
  type: "vetchium-problem-details/invalid-invitation-token",
  title: "Invalid invitation token",
  status: 401,
  detail: "Invitation token is invalid, expired, or consumed",
};

alias InvalidInvitationTokenErrorResponse = AuthenticationResponse<
  "VetchiumAdminInvitation realm=\"admin\"",
  typeof InvalidInvitationTokenError
>;

const InvalidPasswordResetTokenError = #{
  type: "vetchium-problem-details/invalid-password-reset-token",
  title: "Invalid password reset token",
  status: 401,
  detail: "Password reset token is invalid, expired, consumed, or no longer eligible",
};

alias InvalidPasswordResetTokenErrorResponse = AuthenticationResponse<
  "VetchiumAdminPasswordReset realm=\"admin\"",
  typeof InvalidPasswordResetTokenError
>;
