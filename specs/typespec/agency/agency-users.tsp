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

// ===================================
// User Invitation
// ===================================

model AgencyInviteUserRequest {
    @doc("Email address of the user to invite")
    email_address: EmailAddress;
    @doc("Language for the invitation email (e.g., en-US, de-DE). Defaults to inviter's language if not specified.")
    invite_email_language?: LanguageCode;
}

model AgencyInviteUserResponse {
    @doc("Invitation ID")
    invitation_id: string;
    @doc("Expiration timestamp")
    expires_at: string;
}

@route("/agency/invite-user")
interface AgencyInviteUser {
    @tag("AgencyUsers")
    @post
    @doc("Invite a new agency user")
    inviteUser(@body request: AgencyInviteUserRequest): {
        @statusCode statusCode: 201;
        @body response: AgencyInviteUserResponse;
    } | {
        @doc("Validation errors")
        @statusCode statusCode: 400;
    } | {
        @doc("User already exists")
        @statusCode statusCode: 409;
    } | {
        @doc("Unauthorized")
        @statusCode statusCode: 401;
    } | {
        @doc("Forbidden")
        @statusCode statusCode: 403;
    };
}

// ===================================
// Complete Setup
// ===================================

scalar AgencyInvitationToken extends string;

model AgencyCompleteSetupRequest {
    @doc("Invitation token from email")
    invitation_token: AgencyInvitationToken;
    @doc("User's password")
    password: Password;
    @doc("User's full name")
    full_name: FullName;
    @doc("User's preferred language for the application (e.g., en-US, de-DE)")
    preferred_language?: LanguageCode;
}

model AgencyCompleteSetupResponse {
    @doc("Success message")
    message: string;
}

@route("/agency/complete-setup")
interface AgencyCompleteSetup {
    @tag("AgencyUsers")
    @post
    @doc("Complete setup for invited agency user")
    completeSetup(@body request: AgencyCompleteSetupRequest): {
        @statusCode statusCode: 200;
        @body response: AgencyCompleteSetupResponse;
    } | {
        @doc("Validation errors")
        @statusCode statusCode: 400;
    } | {
        @doc("Invalid or expired invitation token")
        @statusCode statusCode: 401;
    };
}

// ============================================
// User Management (Filter Users)
// ============================================

enum AgencyRole {
    invite_users,
    manage_users,
}

model AgencyUser {
    @doc("Email address of the user")
    email_address: EmailAddress;
    @doc("Full name of the user")
    name: string;
    @doc("User status (active/disabled)")
    status: string;
    @doc("ISO 8601 timestamp when user was created")
    created_at: string;
    @doc("List of roles assigned to the user")
    roles: AgencyRole[];
}

model FilterAgencyUsersRequest {
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

model FilterAgencyUsersResponse {
    @doc("List of users")
    items: AgencyUser[];
    @doc("Cursor for next page - base64 encoded value (empty if no more pages)")
    next_cursor: string;
}

@route("/agency/filter-users")
interface AgencyFilterUsers {
    @tag("AgencyUsers")
    @post
    @doc("List/Filter agency users with pagination")
    filterUsers(@body request: FilterAgencyUsersRequest): {
        @statusCode statusCode: 200;
        @body response: FilterAgencyUsersResponse;
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

// ===================================
// Language Management
// ===================================

model AgencySetLanguageRequest {
    @doc("Preferred language code")
    language: LanguageCode;
}

@route("/agency/set-language")
interface AgencySetLanguage {
    @tag("AgencyUsers")
    @post
    @doc("Set preferred language for the authenticated user")
    setLanguage(@body request: AgencySetLanguageRequest): {
        @statusCode statusCode: 200;
    } | {
        @doc("Validation errors")
        @statusCode statusCode: 400;
    } | {
        @doc("Unauthorized")
        @statusCode statusCode: 401;
    };
}

// ===================================
// Get Current User Info
// ===================================

model AgencyMyInfoResponse {
    @doc("Agency user ID")
    agency_user_id: string;
    @doc("Full name of the agency user")
    full_name: string;
    @doc("User's preferred language (BCP 47 tag)")
    preferred_language: LanguageCode;
    @doc("Agency name for display")
    agency_name: string;
    @doc("Whether this user is an agency admin")
    is_admin: boolean;
    @doc("Array of role names assigned to this user")
    roles: string[];
}

@route("/agency/myinfo")
interface AgencyMyInfo {
    @tag("AgencyUsers")
    @get
    @doc("Get current agency user information including roles")
    getMyInfo(): {
        @statusCode statusCode: 200;
        @body response: AgencyMyInfoResponse;
    } | {
        @doc("Invalid or expired session token")
        @statusCode statusCode: 401;
    };
}
