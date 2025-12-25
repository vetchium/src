using TypeSpec.Http;
using TypeSpec.Rest;

@minLength(3)
@maxLength(256)
@pattern("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$")
@doc("A valid email address")
scalar EmailAddress extends string;

@minLength(12)
@maxLength(64)
scalar Password extends string;

@doc("BCP 47 language tag (e.g., en-US, de-DE, ta-IN)")
@minLength(2)
@maxLength(10)
@pattern("^[a-z]{2}(-[A-Z]{2})?$")
scalar LanguageCode extends string;

@minLength(3)
@maxLength(255)
@pattern("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$")
@doc("A valid domain name in lowercase (e.g., example.com)")
scalar DomainName extends string;
