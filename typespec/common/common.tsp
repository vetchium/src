namespace Vetchium;

/**
 * A canonical email address accepted by Vetchium APIs. Clients send a trimmed
 * value; servers defensively remove surrounding whitespace and lowercase it
 * before validation and storage.
 */
@format("email")
scalar EmailAddress extends string;

/** A non-empty password. Passwords are never returned by an API. */
@minLength(1)
scalar Password extends string;
