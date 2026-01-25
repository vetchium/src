import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// Admin TFA Token - returned after initial login for TFA verification
scalar AdminTFAToken extends string;

// Admin Session Token - returned after successful TFA verification
scalar AdminSessionToken extends string;

model AdminLoginRequest {
    email: EmailAddress;
    password: Password;
}

model AdminLoginResponse {
    @doc("TFA token to be used with /admin/tfa endpoint. A 6-digit code has been sent to the admin's email.")
    tfa_token: AdminTFAToken;
}

model AdminTFARequest {
    @doc("TFA token received from /admin/login")
    tfa_token: AdminTFAToken;
    @doc("6-digit code sent to admin's email")
    tfa_code: TFACode;
}

model AdminTFAResponse {
    @doc("Session token for authenticated admin requests")
    session_token: AdminSessionToken;
    @doc("User's preferred language (BCP 47 tag)")
    preferred_language: LanguageCode;
}

model AdminLogoutRequest {
    // Empty model - session token passed in Authorization header
}

model AdminSetLanguageRequest {
    @doc("Preferred language (BCP 47 tag)")
    language: LanguageCode;
}

@route("/admin/login")
interface AdminLogin {
    @tag("AdminUsers")
    @post
    login(@body loginRequest: AdminLoginRequest): {
        @statusCode statusCode: 200;
        @body loginResponse: AdminLoginResponse;
    } | {
        @doc("The Admin account is not in a valid state to login")
        @statusCode
        statusCode: 422;
    } | {
        @doc("Invalid credentials")
        @statusCode
        statusCode: 401;
    };
}

@route("/admin/tfa")
interface AdminTFA {
    @tag("AdminUsers")
    @post
    verifyTFA(@body tfaRequest: AdminTFARequest): {
        @statusCode statusCode: 200;
        @body tfaResponse: AdminTFAResponse;
    } | {
        @doc("Invalid or expired TFA token")
        @statusCode
        statusCode: 401;
    } | {
        @doc("Invalid TFA code")
        @statusCode
        statusCode: 403;
    };
}

@route("/admin/logout")
interface AdminLogout {
    @tag("AdminUsers")
    @post
    logout(@body logoutRequest: AdminLogoutRequest): {
        @statusCode statusCode: 200;
    } | {
        @doc("Invalid or expired session token")
        @statusCode
        statusCode: 401;
    };
}

@route("/admin/set-language")
interface AdminSetLanguage {
    @tag("AdminUsers")
    @post
    @doc("Update the authenticated admin user's preferred language")
    setLanguage(@body request: AdminSetLanguageRequest): {
        @statusCode statusCode: 200;
    } | {
        @doc("Invalid request parameters or validation errors")
        @statusCode
        statusCode: 400;
    } | {
        @doc("Invalid or expired session token")
        @statusCode
        statusCode: 401;
    };
}

// ============================================
// User Management (Disable/Enable)
// ============================================

model AdminDisableUserRequest {
  @doc("Email address of the user to disable")
  email_address: EmailAddress;
}

model AdminEnableUserRequest {
  @doc("Email address of the user to enable")
  email_address: EmailAddress;
}

@route("/admin/disable-user")
interface AdminDisableUser {
  @tag("AdminUsers")
  @post
  @doc("Disable an admin user")
  disableUser(@body request: AdminDisableUserRequest): {
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

@route("/admin/enable-user")
interface AdminEnableUser {
  @tag("AdminUsers")
  @post
  @doc("Enable an admin user")
  enableUser(@body request: AdminEnableUserRequest): {
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

scalar FullName extends string;

model AdminInviteUserRequest {
    @doc("Email address of the user to invite")
    email_address: EmailAddress;
    @doc("Full name of the user")
    full_name: FullName;
    @doc("Preferred language for the user (e.g., en-US, de-DE)")
    preferred_language?: LanguageCode;
}

model AdminInviteUserResponse {
    @doc("Invitation ID")
    invitation_id: string;
    @doc("Expiration timestamp")
    expires_at: string;
}

@route("/admin/invite-user")
interface AdminInviteUser {
    @tag("AdminUsers")
    @post
    @doc("Invite a new admin user")
    inviteUser(@body request: AdminInviteUserRequest): {
        @statusCode statusCode: 201;
        @body response: AdminInviteUserResponse;
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


// ============================================
// User Management (Filter Users)
// ============================================

enum AdminRole {
    invite_users,
    manage_users,
}

model AdminUser {
    @doc("Email address of the user")
    email_address: EmailAddress;
    @doc("Full name of the user")
    name: string;
    @doc("User status (active/disabled)")
    status: string;
    @doc("ISO 8601 timestamp when user was created")
    created_at: string;
    @doc("List of roles assigned to the user")
    roles: AdminRole[];
}

model FilterAdminUsersRequest {
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

model FilterAdminUsersResponse {
    @doc("List of users")
    items: AdminUser[];
    @doc("Cursor for next page - base64 encoded value (empty if no more pages)")
    next_cursor: string;
}

@route("/admin/filter-users")
interface AdminFilterUsers {
    @tag("AdminUsers")
    @post
    @doc("List/Filter admin users with pagination")
    filterUsers(@body request: FilterAdminUsersRequest): {
        @statusCode statusCode: 200;
        @body response: FilterAdminUsersResponse;
    } | {
        @doc("Invalid request parameters")
        @statusCode statusCode: 400;
    } | {
        @doc("Unauthorized")
        @statusCode statusCode: 401;
    };
}
