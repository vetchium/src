namespace Vetchium;

/**
 * An email address accepted by Vetchium APIs. Login requests lowercase this
 * value after removing surrounding whitespace before validating it.
 */
@format("email")
scalar EmailAddress extends string;

/** A non-empty password. Passwords are never returned by an API. */
@minLength(1)
scalar Password extends string;
