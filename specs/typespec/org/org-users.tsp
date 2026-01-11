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

// Org TFA Token - returned after successful login, before TFA verification
scalar OrgTFAToken extends string;

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
// Login Flow
// ============================================

model OrgLoginRequest {
  @doc("Email address of the org user")
  email: EmailAddress;

  @doc("Domain name of the employer (e.g., acme.com) - required to identify which employer context")
  domain: DomainName;

  @doc("User's password")
  password: Password;
}

model OrgLoginResponse {
  @doc("TFA token to be used with /employer/tfa endpoint")
  tfa_token: OrgTFAToken;
}

model OrgTFARequest {
  @doc("TFA token received from /employer/login")
  tfa_token: OrgTFAToken;

  @doc("6-digit code sent to user's email")
  tfa_code: TFACode;

  @doc("Remember this device - extends session to 365 days instead of 24 hours")
  remember_me: boolean;
}

model OrgTFAResponse {
  @doc("Session token for authenticated org user requests")
  session_token: OrgSessionToken;

  @doc("User's preferred language")
  preferred_language: LanguageCode;

  @doc("Employer name for display")
  employer_name: string;
}

model OrgLogoutRequest {
  // Empty - session token passed via Authorization header
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

@route("/employer/login")
interface OrgLogin {
  @tag("OrgUsers")
  @post
  @doc("Login to employer portal. Requires domain to identify which employer context for multi-employer users.")
  login(@body request: OrgLoginRequest): {
    @statusCode statusCode: 200;
    @body response: OrgLoginResponse;
  } | {
    @doc("Validation errors")
    @statusCode
    statusCode: 400;
  } | {
    @doc("Invalid credentials")
    @statusCode
    statusCode: 401;
  } | {
    @doc("Domain not found or not verified")
    @statusCode
    statusCode: 404;
  } | {
    @doc("Account disabled")
    @statusCode
    statusCode: 422;
  };
}

@route("/employer/tfa")
interface OrgTFA {
  @tag("OrgUsers")
  @post
  @doc("Verify TFA code and get session token")
  verifyTFA(@body request: OrgTFARequest): {
    @statusCode statusCode: 200;
    @body response: OrgTFAResponse;
  } | {
    @doc("Validation errors")
    @statusCode
    statusCode: 400;
  } | {
    @doc("Invalid or expired TFA token")
    @statusCode
    statusCode: 401;
  } | {
    @doc("Wrong TFA code")
    @statusCode
    statusCode: 403;
  };
}

@route("/employer/logout")
interface OrgLogout {
  @tag("OrgUsers")
  @post
  @doc("Logout from employer portal. Requires Authorization header with session token.")
  logout(@body request: OrgLogoutRequest): {
    @statusCode statusCode: 200;
  } | {
    @doc("Invalid session")
    @statusCode
    statusCode: 401;
  };
}
