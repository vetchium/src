import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// Hub TFA Token - returned after initial login for TFA verification
scalar HubTFAToken extends string;

// Hub Session Token - returned after successful TFA verification
scalar HubSessionToken extends string;

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
    @doc("Session token to invalidate")
    session_token: HubSessionToken;
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
