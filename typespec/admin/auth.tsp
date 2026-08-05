import "@typespec/http";

import "../common/common.tsp";
import "../problem/details.tsp";
import "./user/user.tsp";

using TypeSpec.Http;

namespace Vetchium.Admin;

/** Credentials submitted to create an admin session. */
model LoginRequest {
  /** Lowercased after surrounding whitespace is removed. */
  email_address: EmailAddress;

  /** Must be non-empty. Login does not apply password-creation length rules. */
  password: Password;
}

/**
 * The supplied email address or password did not authenticate an account.
 * This response intentionally has no body and does not reveal which
 * credential failed.
 */
alias InvalidCredentialsResponse = {
  @statusCode status_code: 401;
  @header("WWW-Authenticate") www_authenticate: "Bearer realm=\"login\"";
};

/**
 * The account authenticated successfully but is disabled. This response has
 * no body.
 */
alias DisabledUserResponse = {
  @statusCode status_code: 403;
};

/**
 * The request lacks a valid admin bearer session. Missing, malformed,
 * expired, revoked, and otherwise invalid bearer credentials use the same
 * bodyless response.
 */
alias AdminAuthenticationRequiredResponse = {
  @statusCode status_code: 401;
  @header("WWW-Authenticate") www_authenticate: "Bearer realm=\"login\"";
};

/** A newly created admin session. */
model LoginResponse {
  /** An opaque bearer token for the authenticated admin session. */
  session_token: string;
  expires_at: utcDateTime;
}

/** Information about the authenticated admin and current session. */
model MyInfoResponse {
  admin_user_id: string;
  email_address: EmailAddress;
  display_name: string;
  admin_user_state: Vetchium.Admin.User.State;
  last_login_at?: utcDateTime;
  created_at: utcDateTime;
  session_expires_at: utcDateTime;
  tenant_id: string;
}

@route("/api/admin")
@tag("Admin authentication")
interface Authentication {
  /** Create an admin session from an email address and password. */
  @route("/login")
  @post
  login(@body request: LoginRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: LoginResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | InvalidCredentialsResponse
    | DisabledUserResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Invalidate the authenticated admin session. */
  @route("/logout")
  @post
  logout():
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | AdminAuthenticationRequiredResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Return the authenticated admin and current-session metadata. */
  @route("/my-info")
  @get
  myInfo():
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: MyInfoResponse;
      }
    | AdminAuthenticationRequiredResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
