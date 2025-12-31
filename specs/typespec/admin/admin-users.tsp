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

model UpdatePreferencesRequest {
    @doc("Preferred language (BCP 47 tag)")
    preferred_language: LanguageCode;
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

@route("/admin/preferences")
interface AdminPreferences {
    @tag("AdminUsers")
    @post
    updatePreferences(@body request: UpdatePreferencesRequest): {
        @statusCode statusCode: 200;
    } | {
        @doc("Invalid or expired session token")
        @statusCode
        statusCode: 401;
    } | {
        @doc("Invalid preference values")
        @statusCode
        statusCode: 400;
    };
}
