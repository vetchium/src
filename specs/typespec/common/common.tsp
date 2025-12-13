using TypeSpec.Http;
using TypeSpec.Rest;

@minLength(3)
@maxLength(256)
@doc("A valid email address")
scalar EmailAddress extends string;

@minLength(12)
@maxLength(64)
scalar Password extends string;
