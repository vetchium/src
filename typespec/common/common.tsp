namespace Vetchium;

/** An email address accepted by Vetchium's login APIs. */
@format("email")
scalar EmailAddress extends string;

/** A non-empty password. Passwords are never returned by an API. */
@minLength(1)
scalar Password extends string;
