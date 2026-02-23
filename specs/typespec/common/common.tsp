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

@minLength(6)
@maxLength(6)
@pattern("^[0-9]{6}$")
@doc("6-digit two-factor authentication code sent via email")
scalar TFACode extends string;

@doc("Request to assign a role to a user within a portal")
model AssignRoleRequest {
    @doc("ID of the user to assign the role to")
    target_user_id: string;
    @doc("Role name to assign (e.g., employer:manage_users)")
    role_name: string;
}

@doc("Request to remove a role from a user within a portal")
model RemoveRoleRequest {
    @doc("ID of the user to remove the role from")
    target_user_id: string;
    @doc("Role name to remove (e.g., employer:manage_users)")
    role_name: string;
}
