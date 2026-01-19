Status: DRAFT
Authors: @psankar
Dependencies: None

## Acceptance Criteria

- TODO

## Scope

We have users on all our 4 portals. We need to implement user management on all the portals with features such as:

### Hub Portal

- Forgot/Reset Password
- Change Password
- Change Email Address

During the hub user signup, we allow signup from only professional email domains that we have already allowlisted. However, after successful signup, the users can switch to their personal email address, from any domain. But one email should be used by one active account only at any time.

### Employer / Admin / Agency Portals

An Entity may refer to generically to an Employer, Admin or Agency in this section.

- Inviting Users
- Disabling/Enabling Users
- Forgot/Reset Password
- Change Password

For Admin, Employer and Agency portals, there can be two types of User Authentication. Some users may have Enterprise managed SSO (via OAuth, SAML etc.) or other forms of authentication (such as a hardware token based) and some may use the usual email+password authentication.

An entity may have both types of authentication at the same time for different sets of users. Each user will however have only one type of authentication at a time.

For people with SSO or any other future type of authentication (such as a hardware token based), these password APIs should not be available.

There should be user roles defined which should be checked before allowing an operation to happen. The first signed in user should be considered an ADMIN who has all roles. Atleast one ADMIN user should be active in an entity and not all ADMIN users can be disabled.

We do not have to support deletion of users and can only support enable/disable of users.

All user information should be saved in the home region which the entity set, during the signup.

An entity that owns a domain may lose control of that domain and some other entity may get hold of that domain. In that case, none of the previous entity's users or settings should affect the newer entity's accesses.

### Other points

- Email addresses should not have a + symbol. It could make multiple accounts to be created with a single original address and so validation checks should prevent this.
- The password reset tokens should be cleaned up when expired and a thread should be run periodically for this. The duration of this periodic thread should be configurable via an environment variable when the server launches.
- The validity of each password reset token type should be configurable via an environment variable when the server launches.
- During the password reset, care should be taken to ensure that the state of the user account, the authentication type etc. are all relevant, as some of these could have changed from the time, the password reset request was sent.

### Database changes

```dbml
TODO
```

### API changes

```typespec
TODO
```
