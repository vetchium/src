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
