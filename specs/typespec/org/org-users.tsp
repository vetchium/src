import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// Org Session Token - returned after successful signup completion
scalar OrgSessionToken extends string;

// Org TFA Token - returned after successful login, before TFA verification
scalar OrgTFAToken extends string;

// DNS Verification Token - used for domain ownership verification
scalar DNSVerificationToken extends string;

// ============================================
// Signup Flow (DNS-based Domain Verification)
// ============================================

model OrgInitSignupRequest {
  @doc("Email address to sign up with - domain will be extracted for verification")
  email: EmailAddress;

  @doc("Home region for the organization (e.g., ind1, usa1, deu1)")
  home_region: string;
}

model OrgInitSignupResponse {
  @doc("The domain being verified (extracted from email)")
  domain: DomainName;

  @doc("DNS TXT record name to create (e.g., _vetchium-verify.example.com)")
  dns_record_name: string;

  @doc("ISO 8601 timestamp when the verification token expires")
  token_expires_at: string;

  @doc("Human-readable instructions")
  message: string;
}

// Org Signup Token - secret token sent via email to complete signup
scalar OrgSignupToken extends string;

model OrgGetSignupDetailsRequest {
  @doc("Signup token received via email")
  signup_token: OrgSignupToken;
}

model OrgGetSignupDetailsResponse {
  @doc("The domain being verified")
  domain: DomainName;
}

model OrgCompleteSignupRequest {
  @doc("Signup token received via email - proves email access")
  signup_token: OrgSignupToken;

  @doc("User's chosen password")
  password: Password;

  @doc("User's preferred language (e.g., en-US, de-DE, ta-IN)")
  preferred_language: LanguageCode;

  @doc("Confirmation that user has added the required DNS record")
  has_added_dns_record: boolean;

  @doc("Confirmation that user agrees to the EULA")
  agrees_to_eula: boolean;
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
  @doc("Initialize signup for a new employer. Claims the domain (extracted from email) and returns DNS verification instructions. An email is also sent with the same instructions.")
  initSignup(@body request: OrgInitSignupRequest): {
    @statusCode statusCode: 200;
    @body response: OrgInitSignupResponse;
  } | {
    @doc("Invalid email format, personal email domain, or validation errors")
    @statusCode
    statusCode: 400;
  } | {
    @doc("Domain already claimed by another employer")
    @statusCode
    statusCode: 409;
  };
}

@route("/org/get-signup-details")
interface OrgGetSignupDetails {
  @tag("OrgUsers")
  @post
  @doc("Get signup details (domain) from signup token without exposing the DNS verification token")
  getSignupDetails(@body request: OrgGetSignupDetailsRequest): {
    @statusCode statusCode: 200;
    @body response: OrgGetSignupDetailsResponse;
  } | {
    @doc("Invalid request parameters or validation errors")
    @statusCode
    statusCode: 400;
  } | {
    @doc("No pending signup found for this token or token expired")
    @statusCode
    statusCode: 404;
  };
}

@route("/org/complete-signup")
interface OrgCompleteSignup {
  @tag("OrgUsers")
  @post
  @doc("Complete signup by verifying the DNS record. Looks up the pending verification by email, checks DNS for the verification token, and creates the employer and user account if verification passes.")
  completeSignup(@body request: OrgCompleteSignupRequest): {
    @statusCode statusCode: 201;
    @body response: OrgCompleteSignupResponse;
  } | {
    @doc("Invalid request parameters or validation errors")
    @statusCode
    statusCode: 400;
  } | {
    @doc("No pending signup found for this email or verification token expired")
    @statusCode
    statusCode: 404;
  } | {
    @doc("DNS verification failed - token not found in DNS TXT records")
    @statusCode
    statusCode: 422;

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

// ============================================
// User Management (Disable/Enable)
// ============================================

model OrgDisableUserRequest {
  @doc("Email address of the user to disable")
  email_address: EmailAddress;
}

model OrgEnableUserRequest {
  @doc("Email address of the user to enable")
  email_address: EmailAddress;
}

@route("/employer/disable-user")
interface OrgDisableUser {
  @tag("OrgUsers")
  @post
  @doc("Disable an org user")
  disableUser(@body request: OrgDisableUserRequest): {
    @statusCode statusCode: 200;
  } | {
    @doc("Validation errors")
    @statusCode
    statusCode: 400;
  } | {
    @doc("User not found")
    @statusCode
    statusCode: 404;
  } | {
    @doc("User already disabled or cannot disable last admin")
    @statusCode
    statusCode: 422;
  };
}

@route("/employer/enable-user")
interface OrgEnableUser {
  @tag("OrgUsers")
  @post
  @doc("Enable an org user")
  enableUser(@body request: OrgEnableUserRequest): {
    @statusCode statusCode: 200;
  } | {
    @doc("Validation errors")
    @statusCode
    statusCode: 400;
  } | {
    @doc("User not found or already active")
    @statusCode
    statusCode: 404;
  };
}

// ============================================
// User Management (Filter Users)
// ============================================

model OrgUser {
    @doc("Email address of the user")
    email_address: EmailAddress;
    @doc("Full name of the user")
    name: string;
    @doc("User status (active/disabled)")
    status: string;
    @doc("ISO 8601 timestamp when user was created")
    created_at: string;
}

model FilterOrgUsersRequest {
    @doc("Number of items to return (default 50, max 100)")
    limit?: int32;
    @doc("Cursor from previous page - base64 encoded value")
    cursor?: string;
    @doc("Filter by email address (partial match)")
    filter_email?: string;
    @doc("Filter by name (partial match)")
    filter_name?: string;
    @doc("Filter by status (exact match: active/disabled)")
    filter_status?: string;
}

model FilterOrgUsersResponse {
    @doc("List of users")
    items: OrgUser[];
    @doc("Cursor for next page - base64 encoded value (empty if no more pages)")
    next_cursor: string;
}

@route("/employer/filter-users")
interface OrgFilterUsers {
    @tag("OrgUsers")
    @post
    @doc("List/Filter org users with pagination")
    filterUsers(@body request: FilterOrgUsersRequest): {
        @statusCode statusCode: 200;
        @body response: FilterOrgUsersResponse;
    } | {
        @doc("Invalid request parameters")
        @statusCode
        statusCode: 400;
    } | {
        @doc("Unauthorized")
        @statusCode
        statusCode: 401;
    };
}
