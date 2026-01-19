Status: DRAFT
Authors: @psankar
Dependencies: None

## Acceptance Criteria

### Hub Portal

- Hub users can request password reset via email and receive a reset link valid for 1 hour
- Hub users can change their password after providing current password verification
- Hub users can change their email address to any domain (not just allowlisted professional domains)
- Email change requires verification via link sent to new email address
- Only one active account can use a specific email address at any time
- All sessions are invalidated after password change/reset or email change

### Entity Portals (Employer/Admin/Agency)

- Users with ADMIN role can invite new users via email
- Invited users receive setup link valid for 7 days to set password and full name
- Users with `manage_users` role can disable/enable other users (except cannot disable all ADMINs)
- At least one ADMIN user must remain active at all times in each entity
- ADMIN users have all individual roles and can assign/remove individual roles to/from other users
- Entity users can request password reset and change password
- All sessions are invalidated when user is disabled or password is changed

### System-wide

- Password reset tokens expire after 1 hour (configurable via environment variable)
- User invitation tokens expire after 7 days (configurable via environment variable)
- Expired tokens are cleaned up every 6 hours via background thread (configurable via environment variable)
- Email addresses cannot contain + symbol (enforced in common.tsp EmailAddress validation)
- Tokens are generated using XID + crypto/rand secret (not UUID) for security
- All user data is stored in the entity's home region
- Password complexity requirements enforced as per common.tsp Password scalar (12-64 characters)

## Scope

We have users on all our 4 portals. We need to implement user management on all the portals with features including password management, email management (Hub only), user invitations, and user status management.

### Hub Portal

#### Forgot/Reset Password

**User Flow:**

1. User clicks "Forgot Password" on login page
2. User enters their email address
3. System validates email format and sends password reset email if account exists
4. User receives email with password reset link containing token (1 hour validity)
5. User clicks link and is directed to password reset page
6. User enters new password
7. System validates token and password, then updates password
8. All existing sessions are invalidated
9. User is directed to login page with success message

**API Flow:**

Request Password Reset:

- **Endpoint**: `POST /hub/request-password-reset`
- **Request**: `{ email_address: EmailAddress }`
- **Response 200**: `{ message: string }` - Generic success message (even if account doesn't exist)
- **Response 400**: Validation errors (email format invalid)
- **Behavior**: Always returns 200 if email format is valid (prevents account enumeration)
- **Side Effects**: If valid active account exists, generate token and send email

Complete Password Reset:

- **Endpoint**: `POST /hub/complete-password-reset`
- **Request**: `{ reset_token: HubPasswordResetToken, new_password: Password }`
- **Response 200**: Empty - Password updated successfully
- **Response 400**: Validation errors (password doesn't meet requirements)
- **Response 401**: Invalid or expired reset token
- **Response 422**: Account in invalid state (disabled, deleted)
- **Side Effects**: Update password hash, delete reset token, invalidate all sessions

**Edge Cases:**

- If account doesn't exist or is disabled: Return 200 with generic message (prevents enumeration)
- If token is expired: Return 401
- If account state changed after token was sent: Return 422
- Multiple reset requests generate new tokens without invalidating old ones until expiry

**Security Considerations:**

- Always return generic success message for reset requests (prevents account enumeration)
- Tokens are single-use (deleted after successful password reset)
- Tokens generated using XID + crypto/rand secret (not predictable UUIDs)

#### Change Password

**User Flow:**

1. Authenticated user navigates to account settings
2. User enters current password and new password
3. System validates current password is correct
4. System updates password
5. All existing sessions except current are invalidated
6. User sees success message

**API Flow:**

- **Endpoint**: `POST /hub/change-password`
- **Request**: `{ current_password: Password, new_password: Password }`
- **Request Headers**: `Authorization: Bearer <HubSessionToken>`
- **Response 200**: Empty - Password changed successfully
- **Response 400**: Validation errors (password format, same as current)
- **Response 401**: Invalid session token OR current password incorrect
- **Response 422**: Account in invalid state (disabled)
- **Side Effects**: Update password hash, invalidate all sessions except current

**Edge Cases:**

- If current password is wrong: Return 401
- If new password same as current: Return 400 with validation error
- If account is disabled during change: Return 422

**Session Handling:**

- Invalidate all sessions EXCEPT the current session
- Current session remains valid so user doesn't have to re-login
- User sees immediate confirmation of password change

#### Change Email Address

**User Flow:**

1. Authenticated Hub user navigates to account settings
2. User enters new email address
3. System validates email format and availability
4. User receives verification email at NEW email address
5. User clicks verification link (1 hour validity)
6. System updates email address
7. All sessions are invalidated
8. User is directed to login page with message to use new email

**API Flow:**

Request Email Change:

- **Endpoint**: `POST /hub/request-email-change`
- **Request**: `{ new_email_address: EmailAddress }`
- **Request Headers**: `Authorization: Bearer <HubSessionToken>`
- **Response 200**: `{ message: string }` - "Verification email sent to new address"
- **Response 400**: Validation errors (email format, contains +)
- **Response 401**: Invalid session token
- **Response 409**: Email already in use by another active account
- **Side Effects**: Generate verification token, send email to new address

Complete Email Change:

- **Endpoint**: `POST /hub/complete-email-change`
- **Request**: `{ verification_token: HubEmailVerificationToken }`
- **Response 200**: Empty - Email updated successfully
- **Response 401**: Invalid or expired verification token
- **Response 409**: Email became unavailable (taken by another account)
- **Response 422**: Account in invalid state (disabled)
- **Side Effects**: Update email address, delete verification token, invalidate all sessions

**Edge Cases:**

- If new email is already in use: Return 409 immediately (before sending verification)
- If verification token expires: User must request email change again
- If email becomes taken between request and verification: Return 409 on complete
- Multiple email change requests: Latest token is valid, previous ones become stale

**Important:**

- Only Hub users can change email addresses
- Entity users (Employer/Admin/Agency) cannot change their email addresses
- During Hub signup, only allowlisted professional email domains are allowed
- After successful signup, users can switch to any email domain (no allowlist restriction)
- One email can only be used by one active account at any time across all portals

### Employer / Admin / Agency Portals

An Entity may refer generically to an Employer, Admin or Agency in this section.

#### Authentication Type Design

Current implementation supports email+password authentication only. However, the database design must accommodate future authentication types (SSO, hardware tokens, etc.) without breaking changes.

**Database Design Principle:**

- Use an `authentication_type` field that can be extended (e.g., enum values: 'email_password', 'sso_oauth', 'sso_saml', 'hardware_token')
- For current implementation, only use 'email_password' value
- Do NOT use boolean flags like `is_sso` or `uses_password` (not extensible)
- Future authentication types should be addable without altering table structure

**Current Scope:**

- All entity users in this specification use email+password authentication
- Password-related APIs (reset, change) are available to all users
- Future: When SSO is added, password APIs will check authentication_type and return 403 for non-password users

#### Inviting Users

**Permissions:** Users with `invite_users` role can invite new users. ADMIN role includes all roles.

**User Flow:**

1. Authorized user navigates to user management section
2. User enters new user's email address and full name
3. System validates email and sends invitation email
4. New user receives email with setup link (7 day validity)
5. New user clicks link and sees setup page
6. New user sets password
7. System activates account
8. New user can login

**API Flow:**

Invite User:

- **Endpoint (Employer)**: `POST /employer/invite-user`
- **Endpoint (Admin)**: `POST /admin/invite-user`
- **Endpoint (Agency)**: `POST /agency/invite-user`
- **Request**: `{ email_address: EmailAddress, full_name: FullName }`
- **Request Headers**: `Authorization: Bearer <SessionToken>`
- **Response 201**: `{ invitation_id: string, expires_at: string }` - Invitation created
- **Response 400**: Validation errors (email format, full name)
- **Response 401**: Invalid session token
- **Response 403**: User lacks `invite_users` role
- **Response 409**: Email already in use by active user in this entity
- **Side Effects**: Create user record (status='invited'), generate invitation token, send email

Complete User Setup:

- **Endpoint (Employer)**: `POST /employer/complete-setup`
- **Endpoint (Admin)**: `POST /admin/complete-setup`
- **Endpoint (Agency)**: `POST /agency/complete-setup`
- **Request**: `{ invitation_token: InvitationToken, password: Password, full_name: FullName }`
- **Response 200**: `{ message: string }` - "Account activated, please login"
- **Response 400**: Validation errors (password requirements, full name)
- **Response 401**: Invalid or expired invitation token
- **Response 404**: No pending invitation found for this token
- **Side Effects**: Update user (password hash, full_name, status='active'), delete invitation token

**Edge Cases:**

- If email already in use by active user: Return 409
- If invitation expires: User must be re-invited by an admin
- If user is re-invited before expiry: Generate new token, invalidate old token, update expiry
- Invited users (status='invited') cannot login until they complete setup
- Full name is provided twice: during invitation (by admin) and during setup (by user) - setup value is used

**Data Storage:**

- All user data stored in entity's home region
- Authentication type set to 'email_password' for invited users

#### Disabling/Enabling Users

**Permissions:** Users with `manage_users` role can disable/enable users. ADMIN role includes all roles.

**User Flow:**

Disable User:

1. Authorized user navigates to user management
2. User selects target user and clicks "Disable"
3. System validates permissions and ADMIN constraints
4. System disables user and terminates their sessions
5. Disabled user cannot login

Enable User:

1. Authorized user navigates to user management
2. User selects disabled user and clicks "Enable"
3. System validates permissions
4. System enables user
5. Enabled user can login again

**API Flow:**

Disable User:

- **Endpoint (Employer)**: `POST /employer/disable-user`
- **Endpoint (Admin)**: `POST /admin/disable-user`
- **Endpoint (Agency)**: `POST /agency/disable-user`
- **Request**: `{ target_user_id: string }`
- **Request Headers**: `Authorization: Bearer <SessionToken>`
- **Response 200**: Empty - User disabled successfully
- **Response 400**: Validation errors (missing user_id)
- **Response 401**: Invalid session token
- **Response 403**: User lacks `manage_users` role
- **Response 404**: Target user not found
- **Response 422**: Cannot disable last ADMIN user
- **Side Effects**: Update user status to 'disabled', invalidate all target user's sessions

Enable User:

- **Endpoint (Employer)**: `POST /employer/enable-user`
- **Endpoint (Admin)**: `POST /admin/enable-user`
- **Endpoint (Agency)**: `POST /agency/enable-user`
- **Request**: `{ target_user_id: string }`
- **Request Headers**: `Authorization: Bearer <SessionToken>`
- **Response 200**: Empty - User enabled successfully
- **Response 400**: Validation errors (missing user_id)
- **Response 401**: Invalid session token
- **Response 403**: User lacks `manage_users` role
- **Response 404**: Target user not found or not in disabled state
- **Side Effects**: Update user status to 'active'

**ADMIN Constraint:**

- Cannot disable the last ADMIN user in an entity
- System must always maintain at least one active ADMIN
- If attempting to disable last ADMIN: Return 422 with message "Cannot disable last admin user"
- Can disable self if not the last ADMIN
- Can demote ADMIN to regular user if not the last ADMIN (via role removal, separate API)

**Edge Cases:**

- Disabling a user immediately terminates ALL their active sessions
- User deletion is not supported - only disable/enable
- Cannot enable a user who was never activated (status='invited') - use different flow
- Disabled users cannot login (return 422 on login attempt)

#### Forgot/Reset Password (Entity Users)

**User Flow:** Same as Hub Portal forgot/reset password flow.

**API Flow:**

Request Password Reset:

- **Endpoint (Employer)**: `POST /employer/request-password-reset`
- **Endpoint (Admin)**: `POST /admin/request-password-reset`
- **Endpoint (Agency)**: `POST /agency/request-password-reset`
- **Request**: `{ email_address: EmailAddress, domain: DomainName }` (domain required for Employer/Agency)
- **Response 200**: `{ message: string }` - Generic success message
- **Response 400**: Validation errors
- **Behavior**: Always returns 200 if format is valid (prevents enumeration)
- **Side Effects**: If valid account exists, generate token and send email

Complete Password Reset:

- **Endpoint (Employer)**: `POST /employer/complete-password-reset`
- **Endpoint (Admin)**: `POST /admin/complete-password-reset`
- **Endpoint (Agency)**: `POST /agency/complete-password-reset`
- **Request**: `{ reset_token: PasswordResetToken, new_password: Password }`
- **Response 200**: Empty - Password updated successfully
- **Response 400**: Validation errors
- **Response 401**: Invalid or expired reset token
- **Response 422**: Account in invalid state
- **Side Effects**: Update password hash, delete reset token, invalidate all sessions

**Note:**

- Admin users do not need domain parameter (only one admin portal)
- Employer and Agency users need domain parameter to identify which entity context
- Future: When SSO is added, check authentication_type and skip password reset for SSO users

#### Change Password (Entity Users)

**User Flow:** Same as Hub Portal change password flow.

**API Flow:**

- **Endpoint (Employer)**: `POST /employer/change-password`
- **Endpoint (Admin)**: `POST /admin/change-password`
- **Endpoint (Agency)**: `POST /agency/change-password`
- **Request**: `{ current_password: Password, new_password: Password }`
- **Request Headers**: `Authorization: Bearer <SessionToken>`
- **Response 200**: Empty - Password changed successfully
- **Response 400**: Validation errors
- **Response 401**: Invalid session token OR current password incorrect
- **Response 422**: Account in invalid state
- **Side Effects**: Update password hash, invalidate all sessions except current

**Note:**

- Entity users cannot change their email address (unlike Hub users)
- Only password can be changed via this API

### Role-Based Access Control

#### ADMIN Role

The ADMIN role is a special role with all permissions.

**Characteristics:**

- First user to sign up for an entity automatically receives ADMIN role
- ADMIN role implicitly has ALL individual roles (no need to assign each role separately)
- ADMIN users can perform all operations without explicit role checks
- ADMIN users can assign/remove roles to/from any user including promoting/demoting ADMIN status

**Database Design:**

- ADMIN is stored as a boolean flag `is_admin` on the user record (NOT in roles table)
- Individual roles are stored in separate many-to-many `user_roles` table
- When checking permissions: `if (user.is_admin || user.hasRole('required_role'))`

**Operations ADMIN can perform:**

- Invite users
- Disable/enable users (except cannot disable last ADMIN)
- Assign/remove roles
- Promote users to ADMIN
- Demote ADMINs to regular users (if not last ADMIN)
- All entity-specific operations

**Constraints:**

- At least one ADMIN must remain active at all times
- Cannot disable last ADMIN (422 error)
- Cannot demote last ADMIN (422 error)
- The ADMIN who completes entity signup is the first ADMIN

#### Individual Roles

Roles are granular permissions assigned to users. The role system is designed to be extensible.

**Current Roles:**

- `invite_users` - Can invite new users to the entity
- `manage_users` - Can enable/disable users
- More roles will be added as features are implemented (e.g., `create_job_postings`, `view_analytics`)

**Role Assignment API:**

Assign Role:

- **Endpoint**: `POST /[employer|admin|agency]/assign-role`
- **Request**: `{ target_user_id: string, role_name: string }`
- **Request Headers**: `Authorization: Bearer <SessionToken>`
- **Response 200**: Empty - Role assigned successfully
- **Response 400**: Validation errors
- **Response 401**: Invalid session token
- **Response 403**: User is not ADMIN (only ADMINs can assign roles)
- **Response 404**: Target user or role not found
- **Response 409**: User already has this role

Remove Role:

- **Endpoint**: `POST /[employer|admin|agency]/remove-role`
- **Request**: `{ target_user_id: string, role_name: string }`
- **Request Headers**: `Authorization: Bearer <SessionToken>`
- **Response 200**: Empty - Role removed successfully
- **Response 400**: Validation errors
- **Response 401**: Invalid session token
- **Response 403**: User is not ADMIN (only ADMINs can remove roles)
- **Response 404**: Target user or role not found
- **Response 409**: User doesn't have this role

**Database Design:**

- Store roles in `roles` table with role metadata
- Many-to-many relationship via `user_roles` join table
- Do NOT use boolean columns like `can_invite_users` on user table (not extensible)

**Role Enforcement:**

- All protected operations check for required role(s)
- Check logic: `if (user.is_admin || user.hasRole('required_role'))`
- If user lacks required role and is not ADMIN: Return 403 Forbidden
- Log all role-based access decisions for audit

**Future Extensibility:**

- New roles can be added to `roles` table without schema changes
- New features simply define their required role and enforce it
- Roles can have descriptions and be surfaced in UI for role management

### Data Isolation and Regional Storage

All user information should be saved in the home region which the entity set during signup:

- Hub users choose region during signup (IND1, USA1, DEU1)
- Entity users inherit the entity's home region (set during entity signup)
- PII and credentials stored only in regional database
- Cross-region user lookups use global database with email hashes

**Domain Ownership Changes:**

An entity that owns a domain may lose control of that domain and some other entity may get hold of that domain. In that case, none of the previous entity's users or settings should affect the newer entity's accesses.

**Implementation Note:**
When validating entity domain ownership, always check:

1. Domain exists and is verified
2. Domain belongs to the requesting entity
3. Domain ownership timestamp is consistent
4. Use entity_id + domain combination for lookups (not domain alone)

### Validation Rules

All validations should be defined in TypeSpec files and reused across Go backend and TypeScript frontend.

#### Email Address

- Defined in: `specs/typespec/common/common.tsp`
- Pattern: `^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`
- Length: 3-256 characters
- **Additional validation**: Must NOT contain + symbol (explicitly reject even though pattern allows it)
- Case handling: Store in lowercase, compare case-insensitively
- Uniqueness: One email per active account across all portals

#### Password

- Defined in: `specs/typespec/common/common.tsp`
- Scalar: `Password extends string`
- Length: 12-64 characters
- **Additional complexity** (enforced at application layer):
  - At least one uppercase letter (A-Z)
  - At least one lowercase letter (a-z)
  - At least one number (0-9)
  - At least one special character from: `!@#$%^&*()_+-=[]{}|;:,.<>?`
- Not the same as current password (for change password operation)

#### Full Name

- Type to be defined in typespec
- Length: 1-128 characters
- Cannot be only whitespace
- May contain letters, spaces, hyphens, apostrophes, and unicode characters

#### Domain Name

- Defined in: `specs/typespec/common/common.tsp`
- Used for Employer and Agency login context

#### Tokens

All tokens must be generated securely using XID + crypto/rand secret (NOT UUID).

**Token Generation Pattern (Go):**

```go
// Generate cryptographically secure random bytes
randomBytes := make([]byte, 32)
if _, err := rand.Read(randomBytes); err != nil {
    return "", err
}

// Combine XID (for uniqueness) with random bytes
xid := xid.New()
token := xid.String() + "-" + base64.URLEncoding.EncodeToString(randomBytes)
```

**Token Types to define in TypeSpec:**

Hub Portal:

- `HubPasswordResetToken extends string` - 1 hour expiry
- `HubEmailVerificationToken extends string` - 1 hour expiry

Employer Portal:

- `OrgPasswordResetToken extends string` - 1 hour expiry
- `OrgInvitationToken extends string` - 7 day expiry

Admin Portal:

- `AdminPasswordResetToken extends string` - 1 hour expiry
- `AdminInvitationToken extends string` - 7 day expiry

Agency Portal:

- `AgencyPasswordResetToken extends string` - 1 hour expiry
- `AgencyInvitationToken extends string` - 7 day expiry

**Token Properties:**

- All tokens are single-use (deleted after successful use)
- All tokens have expiry timestamps
- Tokens stored hashed in database (use bcrypt or similar)
- Tokens transmitted in request bodies (not URLs for security)

### Token Lifecycle

#### Token Creation

- Tokens are generated using XID + crypto/rand for security and uniqueness
- Each token type has its own database table for isolation and easier cleanup
- Token records include:
  - Token value (hashed)
  - User reference (user_id)
  - Expiry timestamp
  - Created timestamp
  - Additional metadata (e.g., new_email for email verification tokens)

#### Token Validation

When validating a token:

1. Hash the provided token
2. Look up hashed token in database
3. Check token hasn't expired (`expiry_time > current_time`)
4. Check associated user still exists
5. Check user state is valid for the operation (status='active' for reset, status='invited' for setup)
6. Return user context if valid

#### Token Cleanup

Background thread runs periodically to delete expired tokens.

**Configuration via Environment Variables:**

- `TOKEN_CLEANUP_INTERVAL_HOURS` (default: 6) - How often cleanup runs
- `PASSWORD_RESET_TOKEN_VALIDITY_HOURS` (default: 1) - Password reset token lifetime
- `EMAIL_VERIFICATION_TOKEN_VALIDITY_HOURS` (default: 1) - Email verification token lifetime
- `USER_INVITATION_TOKEN_VALIDITY_DAYS` (default: 7) - Invitation token lifetime

**Cleanup Process:**

1. Thread wakes up every `TOKEN_CLEANUP_INTERVAL_HOURS` hours
2. Deletes expired tokens from each token table:
   - Password reset tokens where `expiry_time < current_time - grace_period`
   - Email verification tokens where `expiry_time < current_time - grace_period`
   - User invitation tokens where `expiry_time < current_time - grace_period`
3. Log cleanup statistics (number of tokens deleted per type)
4. Use grace period of 1 hour to avoid race conditions

### Session Management

Sessions must be invalidated in the following scenarios:

1. **Password Change:**
   - Invalidate all sessions EXCEPT the current session (for authenticated change password)
   - User can continue current session without re-login
   - All other devices/sessions are logged out

2. **Password Reset:**
   - Invalidate ALL sessions including any current sessions
   - User must re-authenticate after password reset

3. **Email Change (Hub only):**
   - Invalidate ALL sessions after email verification completes
   - User must re-authenticate with new email address

4. **User Disabled:**
   - Immediately invalidate ALL active sessions for the disabled user
   - User cannot login until re-enabled

**Implementation:**

- Session invalidation is implemented by deleting session records from database
- Do NOT use a flag like `is_valid` on session records
- Deletion ensures immediate termination and no session leakage
- For "invalidate all except current", delete all sessions where `session_id != current_session_id`

### Email Communication

All emails should support internationalization based on user's language preference.

#### Password Reset Email

**Trigger:** User requests password reset via `/[portal]/request-password-reset`

**Recipients:** User's registered email address

**Subject:** "Reset Your Vetchium Password"

**Content:**

- Greeting with user's name (if available) or email
- Explanation that password reset was requested
- Reset link with token embedded: `https://[portal].vetchium.com/reset-password?token=<token>`
- Token expiry time: "This link is valid for 1 hour"
- Security warning: "Do not share this link with anyone"
- Ignore message if not requested: "If you did not request this, you can safely ignore this email"

#### Email Change Verification Email

**Trigger:** Hub user requests email change via `/hub/request-email-change`

**Recipients:** NEW email address (not old email)

**Subject:** "Verify Your New Email Address"

**Content:**

- Greeting
- Confirmation that email change was requested for their Vetchium account
- Verification link: `https://hub.vetchium.com/verify-email?token=<token>`
- Token expiry time: "This link is valid for 1 hour"
- Warning: "Clicking this link will change your email address and log you out of all devices"
- Explanation: "You will need to login again with your new email address"

#### User Invitation Email

**Trigger:** Entity user with invite_users role invites new user via `/[portal]/invite-user`

**Recipients:** Invited user's email address

**Subject:** "You've Been Invited to Vetchium [Entity Name]"

**Content:**

- Greeting with invited user's name
- Information about who invited them: "[Inviter Name] has invited you to join [Entity Name] on Vetchium"
- Setup link: `https://[portal].vetchium.com/complete-setup?token=<token>`
- Token expiry time: "This invitation is valid for 7 days"
- What to expect: "Click the link above to set your password and activate your account"
- Support contact if they have questions

### Error Scenarios and HTTP Status Codes

Status codes should be consistent across all APIs following these patterns:

**400 Bad Request:**

- Invalid JSON in request body
- Validation errors (email format, password length, required fields missing)
- Response body: `[{field: string, message: string}]` for validation errors
- Response body: `string` for JSON decode errors

**401 Unauthorized:**

- Invalid or expired session token
- Invalid or expired TFA token
- Invalid or expired password reset token
- Invalid or expired invitation token
- Wrong password (login or change password)
- Response body: Empty

**403 Forbidden:**

- User lacks required role for operation
- Wrong TFA code (valid token but wrong code)
- Response body: Empty

**404 Not Found:**

- Resource doesn't exist (domain, user, entity)
- No pending invitation/signup found for token
- Response body: Empty

**409 Conflict:**

- Email already in use (signup, invitation, email change)
- User already has role (assign role)
- User doesn't have role (remove role)
- Response body: `{ message: string }` with specific error

**422 Unprocessable Entity:**

- Account in invalid state (disabled, not activated)
- Cannot disable last ADMIN
- Cannot demote last ADMIN
- Cannot perform operation due to business logic constraint
- Response body: `{ message: string }` for some cases, Empty for others

**500 Internal Server Error:**

- Database errors
- Email sending failures
- Token generation failures
- Response body: Empty

**Security Note:**

- Password reset requests for non-existent emails return 200 (not 404) to prevent account enumeration
- Account status (disabled, SSO) should not be revealed in public APIs
- Use generic error messages for authentication failures

### Security Considerations

1. **Account Enumeration Prevention:**
   - Password reset requests always return 200 with generic message (even for non-existent emails)
   - Don't reveal account status (disabled, invited) in public-facing error messages
   - Use same response time for existing and non-existing accounts (consider adding random delay)

2. **Session Security:**
   - Immediate session invalidation on security-critical changes
   - Session tokens stored with HttpOnly, Secure, SameSite=Strict cookies
   - Session timeout enforced (24 hours default, 365 days if remember_me)
   - Session tokens transmitted via Authorization header (not cookies for API)

3. **Password Security:**
   - Passwords hashed using bcrypt with cost factor 12 (or argon2)
   - Never log passwords (plaintext or hashed)
   - Password reset tokens are single-use and deleted after successful use
   - Old password required for password change (not just valid session)
   - Password complexity enforced as per common.tsp

4. **Token Security:**
   - All tokens generated using XID + crypto/rand (not predictable UUIDs)
   - Tokens stored hashed in database
   - Tokens are single-use (deleted after successful use or expiry)
   - Tokens have expiry times and are cleaned up regularly
   - Tokens transmitted in request body (not URL query parameters to avoid logging)

5. **Email Security:**
   - Validate email format strictly per common.tsp EmailAddress scalar
   - Reject + symbol explicitly (even if pattern allows it) to prevent alias abuse
   - Email change requires verification of new email (prevents account takeover)
   - Store emails in lowercase, compare case-insensitively

6. **Role Security:**
   - ADMIN role checks enforced for sensitive operations
   - Cannot remove all ADMINs (at least one must remain)
   - Role assignment changes logged for audit trail
   - Check both is_admin flag and individual roles for permissions

7. **Logging Security:**

Never log:

- Passwords (plaintext or hashed)
- Full session tokens (use first 8 chars + "..." for debugging)
- Full password reset tokens
- Full TFA codes
- Full email addresses in error scenarios (use user_id or email hash)

Safe to log:

- User IDs
- Email hashes (for debugging)
- Token prefixes (first 8 characters)
- Operation outcomes (success/failure without sensitive details)
- Role changes (who assigned what role to whom)

### Implementation Phases

Implementation should proceed in small increments with frequent commits. Plan the entire feature set upfront, but implement incrementally.

**Testing Strategy:**

- Write Playwright tests AFTER API implementation
- Write Playwright tests BEFORE UI implementation
- This ensures API correctness is validated before building UI

**Phase 1: Hub Password Reset**

1. Define TypeSpec types for password reset (tokens, request/response)
2. Implement API endpoints: request-password-reset, complete-password-reset
3. Implement token generation and storage
4. Implement email sending
5. Write Playwright API tests for all scenarios (success, expired token, invalid token, etc.)
6. Implement UI components (forgot password form, reset password page)
7. Write Playwright UI tests
8. Git commit: "Implement Hub password reset"

**Phase 2: Hub Change Password**

1. Define TypeSpec types for change password
2. Implement API endpoint: change-password
3. Implement session handling (invalidate all except current)
4. Write Playwright API tests
5. Implement UI component (change password form in settings)
6. Write Playwright UI tests
7. Git commit: "Implement Hub change password"

**Phase 3: Hub Email Change**

1. Define TypeSpec types for email change (verification token, request/response)
2. Implement API endpoints: request-email-change, complete-email-change
3. Implement email conflict checking
4. Implement verification email sending
5. Write Playwright API tests
6. Implement UI components (change email form, verification page)
7. Write Playwright UI tests
8. Git commit: "Implement Hub email change"

**Phase 4: Token Cleanup Thread**

1. Implement background goroutine for token cleanup
2. Implement cleanup logic for all token types
3. Add environment variable configuration
4. Add logging for cleanup statistics
5. Write tests for cleanup logic
6. Git commit: "Implement token cleanup background thread"

**Phase 5: Entity User Invitation (Employer)**

1. Define TypeSpec types for invitation (tokens, request/response)
2. Implement API endpoints: invite-user, complete-setup
3. Implement role checking (invite_users role)
4. Implement invitation email sending
5. Write Playwright API tests
6. Implement UI components (invite user form, setup page)
7. Write Playwright UI tests
8. Git commit: "Implement Employer user invitation"

**Phase 6: Entity User Invitation (Admin and Agency)**

1. Replicate invitation implementation for Admin portal
2. Replicate invitation implementation for Agency portal
3. Write Playwright tests for both portals
4. Git commit: "Implement Admin and Agency user invitation"

**Phase 7: Entity User Management (Disable/Enable)**

1. Define TypeSpec types for user management
2. Implement API endpoints: disable-user, enable-user
3. Implement ADMIN constraint (cannot disable last ADMIN)
4. Implement session invalidation on disable
5. Write Playwright API tests
6. Implement UI components (user list, disable/enable buttons)
7. Write Playwright UI tests
8. Git commit: "Implement Entity user management"

**Phase 8: Entity Password Management**

1. Define TypeSpec types for Entity password reset/change
2. Implement API endpoints for Employer, Admin, Agency portals
3. Reuse logic from Hub password management where possible
4. Write Playwright API tests
5. Implement UI components
6. Write Playwright UI tests
7. Git commit: "Implement Entity password management"

**Phase 9: Role-Based Access Control**

1. Define TypeSpec types for role management
2. Implement roles table and user_roles join table
3. Implement API endpoints: assign-role, remove-role
4. Implement role checking middleware
5. Implement ADMIN role special handling
6. Write Playwright API tests
7. Implement UI for role management (if needed)
8. Write Playwright UI tests
9. Git commit: "Implement role-based access control"

Each phase should include:

- TypeSpec definitions with validation
- Database queries (sqlc) if needed
- Go handler implementation
- Playwright API tests (comprehensive scenarios)
- Frontend UI components
- Playwright UI tests
- Git commit at logical completion point

**Incremental Commits:**

- Commit after completing each API endpoint
- Commit after completing test suite for a feature
- Commit after completing UI for a feature
- Commit messages should be descriptive (not just "WIP" or "updates")

### Database changes

```dbml
TODO
```

### API changes

```typespec
TODO
```
