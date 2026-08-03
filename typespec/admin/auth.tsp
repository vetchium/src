import "@typespec/http";

import "../common/common.tsp";
import "../problem/details.tsp";
import "../problem/admin-auth.tsp";
import "./user/user.tsp";

using TypeSpec.Http;

namespace Vetchium.Admin;

/** An opaque bearer token for an authenticated admin session. */
scalar SessionToken extends string;

/** Credentials submitted to create an admin session. */
model LoginRequest {
  email_address: EmailAddress;
  password: Password;
}

/** A newly created admin session. */
model LoginResponse {
  session_token: SessionToken;
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

alias InternalServerErrorResponse = {
  @statusCode status_code: 500;
  @header("Content-Type") content_type: "application/problem+json";
  @body body: Vetchium.Problem.InternalServerError;
};

alias AuthenticationRequiredResponse = {
  @statusCode status_code: 401;
  @header("Content-Type") content_type: "application/problem+json";
  @header("WWW-Authenticate") www_authenticate: string;
  @body body: Vetchium.Problem.AuthenticationRequired;
};

alias InvalidSessionResponse = {
  @statusCode status_code: 401;
  @header("Content-Type") content_type: "application/problem+json";
  @header("WWW-Authenticate") www_authenticate: string;
  @body body: Vetchium.Problem.InvalidSession;
};

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
    | {
        @statusCode status_code: 400;
        @header("Content-Type") content_type: "application/problem+json";
        @body body:
          | Vetchium.Problem.MalformedRequestBody
          | Vetchium.Problem.InvalidLoginInput;
      }
    | {
        @statusCode status_code: 401;
        @header("Content-Type") content_type: "application/problem+json";
        @header("WWW-Authenticate") www_authenticate: string;
        @body body: Vetchium.Problem.InvalidCredentials;
      }
    | {
        @statusCode status_code: 413;
        @header("Content-Type") content_type: "application/problem+json";
        @body body: Vetchium.Problem.RequestBodyTooLarge;
      }
    | InternalServerErrorResponse;

  /** Invalidate the authenticated admin session. */
  @route("/logout")
  @post
  logout():
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | AuthenticationRequiredResponse
    | InvalidSessionResponse
    | InternalServerErrorResponse;

  /** Return the authenticated admin and current-session metadata. */
  @route("/my-info")
  @get
  myInfo():
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: MyInfoResponse;
      }
    | AuthenticationRequiredResponse
    | InvalidSessionResponse
    | InternalServerErrorResponse;
}
