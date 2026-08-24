import "../details.tsp";

namespace Vetchium.Problem;

const InvalidHubCredentialsError = #{
  type: "vetchium-problem-details/hub-invalid-credentials",
  title: "Invalid Hub credentials",
  status: 401,
  detail: "The supplied credentials are invalid",
};
alias InvalidHubCredentialsErrorResponse = AuthenticationResponse<
  "VetchiumLogin realm=\"hub\"",
  typeof InvalidHubCredentialsError
>;

const IncorrectHubPasswordError = #{
  type: "vetchium-problem-details/hub-incorrect-password",
  title: "Incorrect password",
  status: 422,
  detail: "The password did not verify for the authenticated Hub user",
};
alias IncorrectHubPasswordErrorResponse = Response<
  422,
  typeof IncorrectHubPasswordError
>;

const HubUserDisabledError = #{
  type: "vetchium-problem-details/hub-user-disabled",
  title: "Hub user disabled",
  status: 403,
  detail: "The Hub user is disabled",
};
alias HubUserDisabledErrorResponse = Response<403, typeof HubUserDisabledError>;

const HubAuthenticationRequiredError = #{
  type: "vetchium-problem-details/hub-authentication-required",
  title: "Hub authentication required",
  status: 401,
  detail: "A valid Hub bearer session is required",
};
alias HubAuthenticationRequiredErrorResponse = AuthenticationResponse<
  "Bearer realm=\"hub\"",
  typeof HubAuthenticationRequiredError
>;

const HubRecentAuthenticationRequiredError = #{
  type: "vetchium-problem-details/hub-recent-authentication-required",
  title: "Recent authentication required",
  status: 401,
  detail: "Full authentication must have completed within the preceding five minutes",
};
union HubAuthenticationOrRecentRequiredErrorBody {
  authenticationRequired: typeof HubAuthenticationRequiredError,
  recentAuthenticationRequired: typeof HubRecentAuthenticationRequiredError,
}
alias HubAuthenticationOrRecentRequiredErrorResponse = AuthenticationResponse<
  "Bearer realm=\"hub\"",
  HubAuthenticationOrRecentRequiredErrorBody
>;

const InvalidHubLoginChallengeError = #{
  type: "vetchium-problem-details/hub-invalid-login-challenge",
  title: "Invalid Hub login challenge",
  status: 401,
  detail: "Login challenge is invalid, expired, or consumed",
};
alias InvalidHubLoginChallengeErrorResponse = AuthenticationResponse<
  "VetchiumLoginChallenge realm=\"hub\"",
  typeof InvalidHubLoginChallengeError
>;

const IncorrectHubTOTPCodeError = #{
  type: "vetchium-problem-details/hub-incorrect-totp-code",
  title: "Incorrect TOTP code",
  status: 422,
  detail: "The TOTP code did not verify",
};
alias IncorrectHubTOTPCodeErrorResponse = Response<
  422,
  typeof IncorrectHubTOTPCodeError
>;

const InvalidHubPasswordResetTokenError = #{
  type: "vetchium-problem-details/hub-invalid-password-reset-token",
  title: "Invalid password reset token",
  status: 401,
  detail: "Password reset token is invalid, expired, consumed, or no longer eligible",
};
alias InvalidHubPasswordResetTokenErrorResponse = AuthenticationResponse<
  "VetchiumPasswordReset realm=\"hub\"",
  typeof InvalidHubPasswordResetTokenError
>;
