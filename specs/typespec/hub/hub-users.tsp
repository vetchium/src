import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// Hub Signup Token - returned after requesting signup via email
scalar HubSignupToken extends string;

// Hub TFA Token - returned after initial login for TFA verification
scalar HubTFAToken extends string;

// Hub Session Token - returned after successful TFA verification
scalar HubSessionToken extends string;

// Display name for hub user (supports multiple languages)
@minLength(1)
@maxLength(100)
scalar DisplayName extends string;

// ISO 3166-1 alpha-2 country code (2 uppercase letters)
@minLength(2)
@maxLength(2)
@pattern("^[A-Z]{2}$")
scalar CountryCode extends string;

// User handle (unique identifier, lowercase alphanumeric with hyphens)
@minLength(3)
@maxLength(50)
@pattern("^[a-z0-9-]+$")
scalar Handle extends string;

// Display name entry for multiple language support
model DisplayNameEntry {
    @doc("Language code for this display name")
    language_code: string;
    @doc("Display name in the specified language")
    display_name: DisplayName;
    @doc("Whether this is the preferred display name")
    is_preferred: boolean;
}

model RequestSignupRequest {
    @doc("Email address to sign up with")
    email_address: EmailAddress;
}

model RequestSignupResponse {
    @doc("Confirmation message about signup email")
    message: string;
}

model CompleteSignupRequest {
    @doc("Signup token received via email")
    signup_token: HubSignupToken;
    @doc("User's chosen password")
    password: Password;
    @doc("User's preferred display name")
    preferred_display_name: DisplayName;
    @doc("Additional display names in other languages (optional)")
    other_display_names?: DisplayNameEntry[];
    @doc("User's home region (e.g., IND1, USA1, DEU1)")
    home_region: string;
    @doc("User's preferred language (BCP 47 tag)")
    preferred_language: string;
    @doc("User's country of residence (ISO 3166-1 alpha-2)")
    resident_country_code: CountryCode;
}

model CompleteSignupResponse {
    @doc("Session token for authenticated requests")
    session_token: HubSessionToken;
    @doc("Generated unique handle for the user")
    handle: Handle;
}

model HubLoginRequest {
    email: EmailAddress;
    password: Password;
}

model HubLoginResponse {
    @doc("TFA token to be used with /hub/tfa endpoint. A 6-digit code has been sent to the user's email.")
    tfa_token: HubTFAToken;
}

model HubTFARequest {
    @doc("TFA token received from /hub/login")
    tfa_token: HubTFAToken;
    @doc("6-digit code sent to user's email")
    tfa_code: TFACode;
    @doc("Remember this device - extends session to 365 days instead of 24 hours")
    remember_me: boolean;
}

model HubTFAResponse {
    @doc("Session token for authenticated hub user requests")
    session_token: HubSessionToken;
    @doc("User's preferred language (BCP 47 tag)")
    preferred_language: LanguageCode;
}

model HubLogoutRequest {
    // Empty model - session token passed in Authorization header
}

model HubSetLanguageRequest {
    @doc("Preferred language (BCP 47 tag)")
    language: LanguageCode;
}

@route("/hub/login")
interface HubLogin {
    @tag("HubUsers")
    @post
    login(@body loginRequest: HubLoginRequest): {
        @statusCode statusCode: 200;
        @body loginResponse: HubLoginResponse;
    } | {
        @doc("The User account is not in a valid state to login")
        @statusCode
        statusCode: 422;
    } | {
        @doc("Invalid credentials")
        @statusCode
        statusCode: 401;
    };
}

@route("/hub/tfa")
interface HubTFA {
    @tag("HubUsers")
    @post
    verifyTFA(@body tfaRequest: HubTFARequest): {
        @statusCode statusCode: 200;
        @body tfaResponse: HubTFAResponse;
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

@route("/hub/logout")
interface HubLogout {
    @tag("HubUsers")
    @post
    logout(@body logoutRequest: HubLogoutRequest): {
        @statusCode statusCode: 200;
    } | {
        @doc("Invalid or expired session token")
        @statusCode
        statusCode: 401;
    };
}

@route("/hub/request-signup")
interface HubRequestSignup {
    @tag("HubUsers")
    @post
    @doc("Request signup for a new hub user. Sends a signup token via email if domain is approved.")
    requestSignup(@body request: RequestSignupRequest): {
        @statusCode statusCode: 200;
        @body response: RequestSignupResponse;
    } | {
        @doc("Invalid email format or validation errors")
        @statusCode
        statusCode: 400;
    } | {
        @doc("Email domain not approved for professional accounts")
        @statusCode
        statusCode: 403;
    } | {
        @doc("Email already registered")
        @statusCode
        statusCode: 409;
    };
}

@route("/hub/complete-signup")
interface HubCompleteSignup {
    @tag("HubUsers")
    @post
    @doc("Complete signup using the token received via email. Creates the user account and returns session token.")
    completeSignup(@body request: CompleteSignupRequest): {
        @statusCode statusCode: 201;
        @body response: CompleteSignupResponse;
    } | {
        @doc("Invalid request parameters or validation errors")
        @statusCode
        statusCode: 400;
    } | {
        @doc("Invalid or expired signup token")
        @statusCode
        statusCode: 401;
    } | {
        @doc("Handle already taken or email already registered")
        @statusCode
        statusCode: 409;
    };
}
