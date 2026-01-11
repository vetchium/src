import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// Org Signup Token - returned after requesting signup via email
scalar OrgSignupToken extends string;

// Org Session Token - returned after successful signup completion
scalar OrgSessionToken extends string;

// ============================================
// Signup Flow
// ============================================

model OrgInitSignupRequest {
  @doc("Email address to sign up with")
  email: EmailAddress;

  @doc("Home region for the organization (e.g., ind1, usa1, deu1)")
  home_region: string;
}

model OrgInitSignupResponse {
  @doc("Confirmation message about signup email")
  message: string;
}

model OrgCompleteSignupRequest {
  @doc("Signup token received via email")
  signup_token: OrgSignupToken;

  @doc("User's chosen password")
  password: Password;
}

model OrgCompleteSignupResponse {
  @doc("Session token for authenticated requests")
  session_token: OrgSessionToken;

  @doc("Org user ID")
  org_user_id: string;
}

// ============================================
// API Interfaces
// ============================================

@route("/org/init-signup")
interface OrgInitSignup {
  @tag("OrgUsers")
  @post
  @doc("Request signup for a new org user. Sends a signup token via email.")
  initSignup(@body request: OrgInitSignupRequest): {
    @statusCode statusCode: 200;
    @body response: OrgInitSignupResponse;
  } | {
    @doc("Invalid email format or validation errors")
    @statusCode
    statusCode: 400;
  } | {
    @doc("Email already registered")
    @statusCode
    statusCode: 409;
  };
}

@route("/org/complete-signup")
interface OrgCompleteSignup {
  @tag("OrgUsers")
  @post
  @doc("Complete signup using the token received via email. Creates the org user account.")
  completeSignup(@body request: OrgCompleteSignupRequest): {
    @statusCode statusCode: 201;
    @body response: OrgCompleteSignupResponse;
  } | {
    @doc("Invalid request parameters or validation errors")
    @statusCode
    statusCode: 400;
  } | {
    @doc("Invalid or expired signup token")
    @statusCode
    statusCode: 401;
  };
}
