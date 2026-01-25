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
