Status: IN PROGRESS
Authors: @claude
Dependencies: 4-approved-domains (admin approved domains must be configured)

## Acceptance Criteria

### User Perspective

- As a professional, I can sign up using my work email address from an approved domain
- I receive a verification email within 30 seconds with a link valid for 24 hours
- I can click the verification link multiple times without it expiring (handles antivirus scanners)
- I can provide my preferred display name and optionally display names in other languages
- I can select my preferred region, language, and resident country from dropdown lists
- I am immediately logged in after completing signup with a valid session
- I cannot sign up using common public email domains (gmail.com, yahoo.com, etc.) - the UI warns me client-side
- I cannot sign up if my email domain has not been approved by administrators
- I can login after signing up using my email and password

### Developer Perspective

- Hub user signup only proceeds if email domain exists in approved_domains table with status='active'
- Signup verification tokens are cryptographically secure (32 random bytes, hex encoded)
- Verification links expire after 24 hours
- Verification tokens track consumption (consumed_at) but allow revisits before expiry
- User creation spans global and regional databases with compensating transactions
- Password hashing uses bcrypt with default cost
- Sessions are stored in global database with 24-hour expiry
- Email addresses are hashed (SHA-256) in global DB, plaintext in regional DB
- Hub user handles are auto-generated from email local part + UUID suffix
- Multi-language display names are stored in separate table
- All validation errors return 400 with structured JSON error array
- API returns proper status codes per CLAUDE.md conventions
- Hub login and logout work correctly with persistent sessions
- HubAuth middleware validates sessions from global database

## Scope

### Features Included

1. **Domain-based Signup Eligibility**
   - Only users with emails from admin-approved domains can sign up
   - Client-side filtering of ~20 common public email domains
   - Backend validation against approved_domains table

2. **Email Verification Flow**
   - Request signup sends verification email with secure token
   - 24-hour token expiry
   - Reusable tokens (can visit link multiple times, but only complete signup once)
   - Handles antivirus email scanners that pre-fetch links

3. **User Information Collection**
   - Preferred display name (required)
   - Display names in additional languages (optional, dynamic)
   - Password (12-64 chars)
   - Home region selection (from active regions API)
   - Preferred language selection (from supported languages API)
   - Resident country (ISO 3166-1 alpha-2 code)

4. **Account Creation**
   - Creates user in both global and regional databases
   - Auto-generates unique handle (email local part + UUID)
   - Stores multi-language display names
   - Bcrypt password hashing
   - Immediate session creation for seamless login

5. **Session Management (Bug Fix)**
   - Fixes broken hub user login (currently generates tokens but never stores them)
   - Creates hub_sessions table in global database
   - Implements HubAuth middleware
   - Implements logout functionality
   - 24-hour session token expiry

6. **Supporting APIs**
   - GET regions - Returns active regions for dropdown
   - GET supported languages - Returns languages with BCP 47 codes
   - Check domain - Client can verify if domain is approved

### Out of Scope

- Password reset flow (future work)
- Email change flow (future work)
- Two-factor authentication for hub users (future work)
- Social login (Google, LinkedIn, etc.)
- User-chosen handles (auto-generated only)
- Email verification for existing users
- Admin approval of individual signups
- Captcha or bot prevention
- Rate limiting on signup requests

### Database changes

```dbml
// Global Database

Table hub_signup_tokens {
  signup_token TEXT [pk, not null, note: '64-char hex (32 random bytes)']
  email_address TEXT [not null, note: 'Plaintext for handle generation']
  email_address_hash BYTEA [not null, note: 'SHA-256 hash']
  hashing_algorithm email_address_hashing_algorithm [not null, default: 'SHA-256']
  created_at TIMESTAMP [not null, default: `NOW()`]
  expires_at TIMESTAMP [not null, note: '24 hours from creation']
  consumed_at TIMESTAMP [note: 'NULL until user completes signup']

  Indexes {
    expires_at
    email_address_hash
  }
}

Table hub_user_display_names {
  hub_user_global_id UUID [not null, ref: > hub_users.hub_user_global_id, note: 'CASCADE DELETE']
  language_code TEXT [not null, note: 'BCP 47: en-US, de-DE, ta-IN']
  display_name TEXT [not null, note: '1-100 characters']
  is_preferred BOOLEAN [not null, default: false]
  created_at TIMESTAMP [not null, default: `NOW()`]

  Indexes {
    (hub_user_global_id, language_code) [pk]
    (hub_user_global_id) [unique, where: 'is_preferred = TRUE', note: 'Only one preferred per user']
  }
}

Table hub_users {
  // Existing columns
  hub_user_global_id UUID [pk]
  handle TEXT [not null, unique]
  email_address_hash BYTEA [not null, unique]
  hashing_algorithm email_address_hashing_algorithm [not null]
  status hub_user_status [not null]
  preferred_language language [not null]
  home_region region [not null]
  created_at TIMESTAMP [default: `NOW()`]

  // New column
  resident_country_code TEXT [note: 'ISO 3166-1 alpha-2']
}

Table regions {
  region_code region [pk, note: 'Reuses existing enum']
  region_name TEXT [not null, note: 'Display name: "India - Chennai"']
  is_active BOOLEAN [not null, default: true]
  created_at TIMESTAMP [not null, default: `NOW()`]

  Note: 'Initial data: ind1, usa1, deu1 (active); sgp1 (inactive)'
}

Table supported_languages {
  language_code TEXT [pk, note: 'BCP 47: en-US, de-DE, ta-IN']
  language_name TEXT [not null, note: 'English name: "English", "German", "Tamil"']
  native_name TEXT [not null, note: 'Native: "English", "Deutsch", "தமிழ்"']
  db_enum_value language [not null, note: 'Maps to enum: en, de, ta']
  is_default BOOLEAN [not null, default: false]
  created_at TIMESTAMP [not null, default: `NOW()`]

  Indexes {
    is_default [unique, where: 'is_default = TRUE', note: 'Only one default']
  }

  Note: 'Initial data: en-US (default), de-DE, ta-IN'
}

Table hub_sessions {
  session_token TEXT [pk, not null, note: '64-char hex (32 random bytes)']
  hub_user_global_id UUID [not null, ref: > hub_users.hub_user_global_id, note: 'CASCADE DELETE']
  created_at TIMESTAMP [not null, default: `NOW()`]
  expires_at TIMESTAMP [not null, note: '24 hours from creation']

  Indexes {
    expires_at
    hub_user_global_id
  }
}

// Regional Database

Table hub_users {
  // Existing columns - no changes, just adding notes
  hub_user_id UUID [pk]
  hub_user_global_id UUID [not null, note: 'Links to global hub_users']
  email_address TEXT [not null, unique, note: 'Plaintext PII']
  password_hash BYTEA [note: 'Bcrypt hash']
  created_at TIMESTAMP [default: `NOW()`]
}

Enum email_template_type {
  admin_tfa
  hub_signup_verification [note: 'New value']
}
```

### API changes

```typespec
// All endpoints use POST method per CLAUDE.md convention

namespace Vetchium.Hub;

// Unauthenticated endpoints

@route("/hub/get-regions")
@post
op GetRegions(): {
  @statusCode statusCode: 200;
  @body regions: Region[];
};

@route("/hub/get-supported-languages")
@post
op GetSupportedLanguages(): {
  @statusCode statusCode: 200;
  @body languages: SupportedLanguage[];
};

@route("/hub/check-domain")
@post
op CheckDomain(@body request: CheckDomainRequest): {
  @statusCode statusCode: 200;
  @body response: CheckDomainResponse;
} | {
  @doc("Invalid domain format")
  @statusCode statusCode: 400;
};

@route("/hub/request-signup")
@post
op RequestSignup(@body request: RequestSignupRequest): {
  @statusCode statusCode: 200;
  @body response: RequestSignupResponse;
} | {
  @doc("Invalid email format")
  @statusCode statusCode: 400;
} | {
  @doc("Email domain not approved")
  @statusCode statusCode: 403;
} | {
  @doc("Email already registered")
  @statusCode statusCode: 409;
};

@route("/hub/complete-signup")
@post
op CompleteSignup(@body request: CompleteSignupRequest): {
  @statusCode statusCode: 201;
  @body response: CompleteSignupResponse;
} | {
  @doc("Validation errors")
  @statusCode statusCode: 400;
} | {
  @doc("Invalid or expired signup token")
  @statusCode statusCode: 401;
} | {
  @doc("Email already registered (during token lifetime)")
  @statusCode statusCode: 409;
};

// Authenticated endpoints

@route("/hub/logout")
@post
op Logout(@body request: HubLogoutRequest): {
  @statusCode statusCode: 200;
} | {
  @doc("Invalid or expired session token")
  @statusCode statusCode: 401;
};

// Request/Response Models

model Region {
  region_code: string;
  region_name: string;
}

model SupportedLanguage {
  language_code: LanguageCode;
  language_name: string;
  native_name: string;
  is_default: boolean;
}

model DisplayNameEntry {
  language_code: LanguageCode;
  display_name: DisplayName;
  is_preferred: boolean;
}

model CheckDomainRequest {
  domain: DomainName;
}

model CheckDomainResponse {
  is_approved: boolean;
}

model RequestSignupRequest {
  email_address: EmailAddress;
}

model RequestSignupResponse {
  message: string;
}

model CompleteSignupRequest {
  signup_token: HubSignupToken;
  email_address: EmailAddress;  // Must match token
  password: Password;
  preferred_display_name: DisplayName;
  other_display_names?: DisplayNameEntry[];
  home_region: string;
  preferred_language: LanguageCode;
  resident_country_code: CountryCode;
}

model CompleteSignupResponse {
  session_token: HubSessionToken;
  handle: Handle;
}

model HubLogoutRequest {
  session_token: HubSessionToken;
}

// Scalar Types

@minLength(1)
@maxLength(100)
scalar DisplayName extends string;

@minLength(2)
@maxLength(2)
@pattern("^[A-Z]{2}$")
scalar CountryCode extends string;

@minLength(3)
@maxLength(50)
@pattern("^[a-z0-9-]+$")
scalar Handle extends string;

scalar HubSignupToken extends string;
scalar HubSessionToken extends string;
```

## Implementation Notes

### Handle Generation Algorithm

```go
func generateHandle(email string) string {
    // Extract local part before @
    localPart := strings.Split(email, "@")[0]

    // Sanitize: remove special chars, convert to lowercase
    localPart = strings.ToLower(localPart)
    localPart = regexp.MustCompile(`[^a-z0-9-]`).ReplaceAllString(localPart, "-")

    // Truncate if too long (leave room for UUID suffix)
    if len(localPart) > 40 {
        localPart = localPart[:40]
    }

    // Generate 8-char UUID suffix for uniqueness
    suffix := uuid.New().String()[:8]

    return fmt.Sprintf("%s-%s", localPart, suffix)
}
```

### Language Code Mapping

The system uses two language code formats:
- **BCP 47 tags** (en-US, de-DE, ta-IN) in APIs and TypeScript
- **Short codes** (en, de, ta) in database enum

The `supported_languages` table provides the mapping via `db_enum_value` column.

### Email Verification Flow

1. User submits email via `/hub/request-signup`
2. Backend:
   - Validates domain is in approved_domains (status='active')
   - Checks email not already registered
   - Generates 64-char signup token
   - Stores token with 24h expiry
   - Enqueues email with signup link
3. User receives email: `https://hub.vetchium.com/signup/verify?token={signup_token}`
4. User clicks link (can visit multiple times)
5. Frontend loads signup form with token from URL query param
6. User fills form and submits to `/hub/complete-signup`
7. Backend:
   - Verifies token is valid and not expired
   - Verifies email matches token (hash comparison)
   - Creates user in global + regional DBs
   - Creates session token
   - Marks signup token as consumed
8. Frontend receives session token and redirects to dashboard (logged in)

### Compensating Transactions

Since we cannot use a single transaction across global and regional databases:

**Pattern for CompleteSignup:**
```go
// 1. Create in global DB first (3 operations)
globalUser, err := s.Global.CreateHubUser(ctx, globalParams)
if err != nil {
    return err
}

displayName, err := s.Global.CreateHubUserDisplayName(ctx, displayNameParams)
if err != nil {
    s.Global.DeleteHubUser(ctx, globalUser.HubUserGlobalID)
    return err
}

// ... other display names ...

// 2. Create in regional DB (compensate on failure)
regionalUser, err := regionalDB.CreateHubUser(ctx, regionalParams)
if err != nil {
    // Compensating transaction: delete from global
    s.Global.DeleteHubUser(ctx, globalUser.HubUserGlobalID)
    return err
}

// 3. Create session (compensate on failure)
err = s.Global.CreateHubSession(ctx, sessionParams)
if err != nil {
    // Compensate both DBs
    regionalDB.DeleteHubUser(ctx, regionalUser.HubUserID)
    s.Global.DeleteHubUser(ctx, globalUser.HubUserGlobalID)
    return err
}

// 4. Mark token consumed (best effort, non-critical)
s.Global.MarkHubSignupTokenConsumed(ctx, signupToken)
```

### Security Considerations

1. **Token Generation**: Use `crypto/rand` for all tokens (signup, session)
2. **Password Hashing**: Bcrypt with default cost (currently 10)
3. **Email Hashing**: SHA-256 in global DB for privacy
4. **Token Expiry**: Database-enforced via `WHERE expires_at > NOW()`
5. **Session Expiry**: 24 hours, enforced in query
6. **Input Validation**: All fields validated in TypeSpec with structured errors

### Frontend Client-Side Optimizations

**Common Email Domains (hardcoded in TypeScript):**
```typescript
export const COMMON_EMAIL_DOMAINS = [
    "gmail.com", "yahoo.com", "outlook.com", "hotmail.com",
    "icloud.com", "live.com", "msn.com", "aol.com",
    "protonmail.com", "mail.com", "yandex.com", "gmx.com",
    "zoho.com", "inbox.com", "fastmail.com", "hey.com",
    "tutanota.com", "mailfence.com", "posteo.de", "runbox.com"
];
```

When user enters email, extract domain and check against this list. If match, show warning immediately without making network call.

## Test Coverage

### API Tests (Playwright)

**Request Signup:**
- ✓ Success: approved domain sends email
- ✓ 403: unapproved domain rejected
- ✓ 409: already registered email rejected
- ✓ 400: invalid email format rejected
- ✓ 400: missing email field rejected

**Complete Signup:**
- ✓ Success: creates user and returns session token
- ✓ 401: invalid/expired token rejected
- ✓ 409: duplicate email during token lifetime rejected
- ✓ 400: email doesn't match token rejected
- ✓ 400: invalid password (too short) rejected
- ✓ 400: invalid country code rejected
- ✓ 400: invalid region rejected
- ✓ 400: invalid language rejected
- ✓ 400: missing required fields rejected
- ✓ Multiple display names stored correctly

**Get Regions:**
- ✓ Returns only active regions
- ✓ Returns correct structure

**Get Supported Languages:**
- ✓ Returns all languages with default flag
- ✓ Default language is en-US

**Check Domain:**
- ✓ Returns true for approved active domain
- ✓ Returns false for unapproved domain
- ✓ Returns false for approved inactive domain

**Login (Fixed):**
- ✓ Success after signup creates session
- ✓ Session token can be used for authenticated requests

**Logout:**
- ✓ Deletes session successfully
- ✓ Session token invalid after logout

**Token Reusability:**
- ✓ Can visit signup link multiple times
- ✓ Can only complete signup once (409 on second attempt)

### UI Tests (Future)

- Email input validation with common domain warning
- Multi-language display name dynamic add/remove
- Region/language/country dropdowns load correctly
- Password strength indicator
- Form validation error display
- Successful signup redirects to dashboard
- All strings translated in 3 languages

## Migration Path

### For Existing Hub Users

This feature does not affect existing hub users who may have been created through other means (if any exist). The migration adds new columns and tables that are nullable or have defaults.

Existing users without `resident_country_code` will have NULL values - this is acceptable.

### For Existing Approved Domains

This feature leverages the existing approved domains system (spec 4). Administrators must have already configured approved domains before users can sign up.

## Future Enhancements

1. **Password Reset Flow**: Use signup token pattern for password reset links
2. **Email Verification for Existing Users**: Allow users to verify additional email addresses
3. **Two-Factor Authentication**: Add TFA option for hub users (similar to admin TFA)
4. **Account Invitation System**: Admins or org users can invite specific professionals
5. **Social Login**: OAuth integration with LinkedIn, Google
6. **Profile Completion**: Prompt for additional info after signup
7. **Email Preferences**: Allow users to opt out of certain email types
8. **Handle Customization**: Allow users to choose custom handles (with uniqueness check)

## Success Metrics

- 95%+ signup completion rate (users who receive verification email actually complete signup)
- < 5% common domain rejection rate (most users understand they need work email)
- < 1% support requests related to signup issues
- Average signup flow completion time: < 3 minutes
- Email delivery time: < 30 seconds for 99th percentile
- Zero duplicate email addresses in database
- Zero security incidents related to token generation or password storage
