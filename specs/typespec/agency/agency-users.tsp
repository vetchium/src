import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// Agency Session Token - returned after successful signup completion
scalar AgencySessionToken extends string;

// Agency TFA Token - returned after successful login, before TFA verification
scalar AgencyTFAToken extends string;

// DNS Verification Token - used for domain ownership verification
scalar DNSVerificationToken extends string;

// ============================================
// Signup Flow (DNS-based Domain Verification)
// ============================================

model AgencyInitSignupRequest {
  @doc("Email address to sign up with - domain will be extracted for verification")
  email: EmailAddress;

  @doc("Home region for the agency (e.g., ind1, usa1, deu1)")
  home_region: string;
}

model AgencyInitSignupResponse {
  @doc("The domain being verified (extracted from email)")
  domain: DomainName;

  @doc("DNS TXT record name to create (e.g., _vetchium-verify.example.com)")
  dns_record_name: string;

  @doc("ISO 8601 timestamp when the verification token expires")
  token_expires_at: string;

  @doc("Human-readable instructions")
  message: string;
}

// Agency Signup Token - secret token sent via email to complete signup
scalar AgencySignupToken extends string;

model AgencyGetSignupDetailsRequest {
  @doc("Signup token received via email")
  signup_token: AgencySignupToken;
}

model AgencyGetSignupDetailsResponse {
  @doc("The domain being verified")
  domain: DomainName;
}

model AgencyCompleteSignupRequest {
  @doc("Signup token received via email - proves email access")
  signup_token: AgencySignupToken;

  @doc("User's chosen password")
  password: Password;

  @doc("User's preferred language (e.g., en-US, de-DE, ta-IN)")
  preferred_language: LanguageCode;

  @doc("Confirmation that user has added the required DNS record")
  has_added_dns_record: boolean;

  @doc("Confirmation that user agrees to the EULA")
  agrees_to_eula: boolean;
}

model AgencyCompleteSignupResponse {
  @doc("Session token for authenticated requests")
  session_token: AgencySessionToken;

  @doc("Agency user ID")
  agency_user_id: string;
}



// ============================================
// Login Flow
// ============================================

model AgencyLoginRequest {
  @doc("Email address of the agency user")
  email: EmailAddress;

  @doc("Domain name of the agency (e.g., acme-recruiting.com) - required to identify which agency context")
  domain: DomainName;

  @doc("User's password")
  password: Password;
}

model AgencyLoginResponse {
  @doc("TFA token to be used with /agency/tfa endpoint")
  tfa_token: AgencyTFAToken;
}

model AgencyTFARequest {
  @doc("TFA token received from /agency/login")
  tfa_token: AgencyTFAToken;

  @doc("6-digit code sent to user's email")
  tfa_code: TFACode;

  @doc("Remember this device - extends session to 365 days instead of 24 hours")
  remember_me: boolean;
}

model AgencyTFAResponse {
  @doc("Session token for authenticated agency user requests")
  session_token: AgencySessionToken;

  @doc("User's preferred language")
  preferred_language: LanguageCode;

  @doc("Agency name for display")
  agency_name: string;
}

model AgencyLogoutRequest {
  // Empty - session token passed via Authorization header
}

// ============================================
// API Interfaces
// ============================================

@route("/agency/init-signup")
interface AgencyInitSignup {
  @tag("AgencyUsers")
  @post
  @doc("Initialize signup for a new agency. Claims the domain (extracted from email) and returns DNS verification instructions. An email is also sent with the same instructions.")
  initSignup(@body request: AgencyInitSignupRequest): {
    @statusCode statusCode: 200;
    @body response: AgencyInitSignupResponse;
  } | {
    @doc("Invalid email format, personal email domain, or validation errors")
    @statusCode
    statusCode: 400;
  } | {
    @doc("Domain already claimed by another agency")
    @statusCode
    statusCode: 409;
  };
}

@route("/agency/get-signup-details")
interface AgencyGetSignupDetails {
  @tag("AgencyUsers")
  @post
  @doc("Get signup details (domain) from signup token without exposing the DNS verification token")
  getSignupDetails(@body request: AgencyGetSignupDetailsRequest): {
    @statusCode statusCode: 200;
    @body response: AgencyGetSignupDetailsResponse;
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

@route("/agency/complete-signup")
interface AgencyCompleteSignup {
  @tag("AgencyUsers")
  @post
  @doc("Complete signup by verifying the DNS record. Looks up the pending verification by email, checks DNS for the verification token, and creates the agency and user account if verification passes.")
  completeSignup(@body request: AgencyCompleteSignupRequest): {
    @statusCode statusCode: 201;
    @body response: AgencyCompleteSignupResponse;
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

@route("/agency/login")
interface AgencyLogin {
  @tag("AgencyUsers")
  @post
  @doc("Login to agency portal. Requires domain to identify which agency context for multi-agency users.")
  login(@body request: AgencyLoginRequest): {
    @statusCode statusCode: 200;
    @body response: AgencyLoginResponse;
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

@route("/agency/tfa")
interface AgencyTFA {
  @tag("AgencyUsers")
  @post
  @doc("Verify TFA code and get session token")
  verifyTFA(@body request: AgencyTFARequest): {
    @statusCode statusCode: 200;
    @body response: AgencyTFAResponse;
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

@route("/agency/logout")
interface AgencyLogout {
  @tag("AgencyUsers")
  @post
  @doc("Logout from agency portal. Requires Authorization header with session token.")
  logout(@body request: AgencyLogoutRequest): {
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

model AgencyDisableUserRequest {
  @doc("Email address of the user to disable")
  email_address: EmailAddress;
}

model AgencyEnableUserRequest {
  @doc("Email address of the user to enable")
  email_address: EmailAddress;
}

@route("/agency/disable-user")
interface AgencyDisableUser {
  @tag("AgencyUsers")
  @post
  @doc("Disable an agency user")
  disableUser(@body request: AgencyDisableUserRequest): {
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

@route("/agency/enable-user")
interface AgencyEnableUser {
  @tag("AgencyUsers")
  @post
  @doc("Enable an agency user")
  enableUser(@body request: AgencyEnableUserRequest): {
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
