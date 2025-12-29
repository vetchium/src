Status: DRAFT
Authors: @psankar
Dependencies: 5-hubuser-signup

## Acceptance Criteria

- Hub users must verify login with a 6-digit code sent to their email after successful password authentication
- Hub users can optionally set "remember_me" to extend session validity from 24 hours to 365 days
- TFA tokens expire after 10 minutes
- TFA codes are randomly generated 6-digit numbers
- Email contains the TFA code and expiry time in user's preferred language
- Sessions are invalidated on logout
- Invalid or expired TFA tokens return 401
- Wrong TFA codes return 403
- All APIs follow the same validation and error handling patterns as admin users

## Scope

- Modify existing hub login API to return TFA token instead of session token
- Add hub TFA verification API that returns session token
- Add hub_tfa_tokens table in global database
- Support "remember_me" parameter for extended sessions (365 days vs 24 hours)
- Send TFA codes via email using existing email queue system in regional database
- Logout API already exists and doesn't need changes
- Tests for all endpoints covering success cases, validation errors, auth failures, and edge cases

### Database changes

```dbml
// Global database - hub_tfa_tokens table
Table hub_tfa_tokens {
  tfa_token TEXT [pk, not null]
  hub_user_global_id UUID [not null, ref: > hub_users.hub_user_global_id, on_delete: cascade]
  tfa_code TEXT [not null]
  created_at TIMESTAMP [not null, default: `NOW()`]
  expires_at TIMESTAMP [not null]

  indexes {
    expires_at
  }
}
```

### API changes

```typespec
// Hub TFA Token - returned after initial login for TFA verification
scalar HubTFAToken extends string;

// Hub Session Token - already exists, no changes needed
scalar HubSessionToken extends string;

// TFA Code - code sent via email (reuse TFACode from admin-users.tsp)
@minLength(6)
@maxLength(6)
@pattern("^[0-9]{6}$")
scalar TFACode extends string;

// MODIFIED: Login now returns TFA token instead of session token
model HubLoginRequest {
    email_address: EmailAddress;
    password: Password;
}

model HubLoginResponse {
    @doc("TFA token to be used with /hub/tfa endpoint. A 6-digit code has been sent to the user's email.")
    tfa_token: HubTFAToken;
}

// NEW: TFA verification endpoint
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

// Logout unchanged - already exists
model HubLogoutRequest {
    @doc("Session token to invalidate")
    session_token: HubSessionToken;
}

@route("/hub/login")
interface HubLogin {
    @tag("HubUsers")
    @post
    login(@body loginRequest: HubLoginRequest):
        200 with HubLoginResponse
        | 401 (Invalid credentials)
        | 422 (Account not in valid state);
}

@route("/hub/tfa")
interface HubTFA {
    @tag("HubUsers")
    @post
    verifyTFA(@body tfaRequest: HubTFARequest):
        200 with HubTFAResponse
        | 401 (Invalid or expired TFA token)
        | 403 (Invalid TFA code);
}

@route("/hub/logout")
interface HubLogout {
    @tag("HubUsers")
    @post
    logout(@body logoutRequest: HubLogoutRequest):
        200
        | 401 (Invalid or expired session token);
}
```

### Implementation notes

- Follow the exact same pattern as admin 2FA implementation
- Login handler generates TFA token and code, stores in global DB, enqueues email in regional DB
- Use compensating transaction for cross-database operations (if email fails, delete TFA token)
- TFA handler verifies code, creates session with appropriate expiry based on remember_me flag
- Session expiry: 24 hours (default) or 365 days (remember_me=true)
- Email template should match user's preferred_language from hub_users table
- TFA tokens intentionally not deleted after successful verification (allows retry if session creation fails)
