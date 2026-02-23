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
    email_address: EmailAddress;
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

@route("/hub/set-language")
interface HubSetLanguage {
    @tag("HubUsers")
    @post
    @doc("Update the authenticated hub user's preferred language")
    setLanguage(@body request: HubSetLanguageRequest): {
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

// ============================================
// Password Reset
// ============================================

scalar HubPasswordResetToken extends string;

model HubRequestPasswordResetRequest {
    @doc("Email address of the account to reset password for")
    email_address: EmailAddress;
}

model HubRequestPasswordResetResponse {
    @doc("Confirmation message")
    message: string;
}

model HubCompletePasswordResetRequest {
    @doc("Password reset token received via email")
    reset_token: HubPasswordResetToken;
    @doc("New password to set")
    new_password: Password;
}

@route("/hub/request-password-reset")
interface HubRequestPasswordReset {
    @tag("HubUsers")
    @post
    @doc("Request a password reset email. Always returns 200 to prevent email enumeration.")
    requestPasswordReset(@body request: HubRequestPasswordResetRequest): {
        @statusCode statusCode: 200;
        @body response: HubRequestPasswordResetResponse;
    } | {
        @doc("Invalid request parameters or validation errors")
        @statusCode statusCode: 400;
    };
}

@route("/hub/complete-password-reset")
interface HubCompletePasswordReset {
    @tag("HubUsers")
    @post
    @doc("Complete password reset using the token received via email")
    completePasswordReset(@body request: HubCompletePasswordResetRequest): {
        @statusCode statusCode: 200;
    } | {
        @doc("Invalid request parameters or validation errors")
        @statusCode statusCode: 400;
    } | {
        @doc("Invalid or expired reset token")
        @statusCode statusCode: 401;
    };
}

// ============================================
// Change Password
// ============================================

model HubChangePasswordRequest {
    @doc("Current password for verification")
    current_password: Password;
    @doc("New password to set")
    new_password: Password;
}

@route("/hub/change-password")
interface HubChangePassword {
    @tag("HubUsers")
    @post
    @doc("Change password for the authenticated hub user")
    changePassword(@body request: HubChangePasswordRequest): {
        @statusCode statusCode: 200;
    } | {
        @doc("Invalid request parameters or validation errors")
        @statusCode statusCode: 400;
    } | {
        @doc("Invalid or expired session token, or wrong current password")
        @statusCode statusCode: 401;
    };
}

// ============================================
// Email Change
// ============================================

scalar HubEmailVerificationToken extends string;

model HubRequestEmailChangeRequest {
    @doc("New email address to change to")
    new_email_address: EmailAddress;
}

model HubRequestEmailChangeResponse {
    @doc("Confirmation message")
    message: string;
}

model HubCompleteEmailChangeRequest {
    @doc("Verification token received via email")
    verification_token: HubEmailVerificationToken;
}

@route("/hub/request-email-change")
interface HubRequestEmailChange {
    @tag("HubUsers")
    @post
    @doc("Request an email change. Sends a verification token to the new email address.")
    requestEmailChange(@body request: HubRequestEmailChangeRequest): {
        @statusCode statusCode: 200;
        @body response: HubRequestEmailChangeResponse;
    } | {
        @doc("Invalid request parameters or validation errors")
        @statusCode statusCode: 400;
    } | {
        @doc("Invalid or expired session token")
        @statusCode statusCode: 401;
    } | {
        @doc("Email already in use")
        @statusCode statusCode: 409;
    };
}

@route("/hub/complete-email-change")
interface HubCompleteEmailChange {
    @tag("HubUsers")
    @post
    @doc("Complete email change using the verification token sent to the new email")
    completeEmailChange(@body request: HubCompleteEmailChangeRequest): {
        @statusCode statusCode: 200;
    } | {
        @doc("Invalid request parameters or validation errors")
        @statusCode statusCode: 400;
    } | {
        @doc("Invalid or expired verification token")
        @statusCode statusCode: 401;
    };
}

// ============================================
// Get Current User Info
// ============================================

model HubMyInfoResponse {
    @doc("Hub user ID")
    hub_user_id: string;
    @doc("User's unique handle")
    handle: Handle;
    @doc("Email address of the hub user")
    email_address: EmailAddress;
    @doc("User's preferred language (BCP 47 tag)")
    preferred_language: LanguageCode;
    @doc("Array of role names assigned to this user")
    roles: string[];
}

@route("/hub/myinfo")
interface HubMyInfo {
    @tag("HubUsers")
    @get
    @doc("Get current hub user information including roles")
    getMyInfo(): {
        @statusCode statusCode: 200;
        @body response: HubMyInfoResponse;
    } | {
        @doc("Invalid or expired session token")
        @statusCode statusCode: 401;
    };
}
