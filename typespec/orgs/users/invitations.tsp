import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/idempotency.tsp";
import "../../common/pagination.tsp";
import "../../common/security-effects.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "../../problem/orgs/suspension.tsp";
import "../../problem/orgs/users.tsp";
import "../authorization/types.tsp";
import "../types.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs;

scalar OrgInvitationToken extends Vetchium.Authentication.OpaqueToken;

/**
 * An address as the inviter typed it. It is lowercased after surrounding
 * whitespace is removed; one that is not a valid address is reported as
 * `invalid` for that address, not as a failure of the request.
 */
@minLength(1)
@maxLength(320)
scalar InviteeAddress extends string;

enum InviteOutcome {
  Invited: "invited",
  AlreadyMember: "already-member",
  AlreadyInvited: "already-invited",
  DomainMismatch: "domain-mismatch",
  Invalid: "invalid",
}

/** Invite up to 100 people to one Org with one set of initial grants. */
model InviteUsersRequest {
  /** Unique after normalization. */
  @minItems(1)
  @maxItems(100)
  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  email_addresses: InviteeAddress[];

  /**
   * Directly assigned permissions every invitee starts with. Every value must
   * be a permission this API version defines.
   */
  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  permissions?: OrgPermissionID[];
}

model InviteResult {
  /** The normalized address. */
  email_address: string;

  outcome: InviteOutcome;

  /** Present only for `invited`. */
  expires_at?: utcDateTime;
}

model InviteUsersResponse {
  /** One result per requested address, in request order. */
  results: InviteResult[];
}

@minLength(2)
@maxLength(320)
scalar InvitationFilterText extends string;

model ListInvitationsRequest {
  /** Defaults to 50. */
  limit?: PageSize = 50;

  pagination_key?: PaginationKey;

  /** Case-insensitive partial match against the invited address. */
  filter_search?: InvitationFilterText;
}

model InvitationSummary {
  email_address: EmailAddress;
  permissions: OrgPermissionID[];
  invited_by: EmailAddress;
  created_at: utcDateTime;

  /** An invitation past this instant is expired and holds no seat. */
  expires_at: utcDateTime;
}

model ListInvitationsResponse {
  invitations: InvitationSummary[];
  next_pagination_key?: PaginationKey;
}

model ResendInvitationRequest {
  email_address: EmailAddress;
}

model ResendInvitationResponse {
  expires_at: utcDateTime;
}

model CancelInvitationsRequest {
  @minItems(1)
  @maxItems(100)
  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  email_addresses: EmailAddress[];
}

model GetInvitationDetailsRequest {
  invitation_token: OrgInvitationToken;
}

model InvitationDetailsResponse {
  domain: OrgDomain;
  email_address: EmailAddress;
  expires_at: utcDateTime;
}

model AcceptInvitationRequest {
  invitation_token: OrgInvitationToken;
  password: Vetchium.Authentication.NewPassword;

  /** Initial user-interface locale selected in the browser. */
  preferred_language: FrontendLocale;
}

model AcceptInvitationResponse {
  domain: OrgDomain;
  email_address: EmailAddress;
}

@route("/api/orgs")
@tag("Org invitations")
interface InvitationOperations {
  /**
   * Create invitations and queue their emails, atomically against the seat
   * cap. A caller holding `org:manage_users` but not `org:superadmin` may not
   * grant `org:superadmin` or `org:manage_billing`.
   */
  @route("/invite-users")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_users"
  )
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-idempotency-binding",
    #[
      "operation",
      "authenticated-principal",
      "canonical-request-digest",
      "idempotency-key"
    ]
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.CreateOrgInvitation,
      Vetchium.SecurityEffect.QueueOrgInvitationEmail
    ]
  )
  inviteUsers(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: InviteUsersRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: InviteUsersResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.OrgUserLimitReachedErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** List pending invitations ordered by address. */
  @route("/list-invitations")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_users"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-consistency",
    "live-best-effort"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-key-binds",
    #["normalized-filters", "email_address"]
  )
  listInvitations(@body request: ListInvitationsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListInvitationsResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Rotate the token, restart the lifetime, and queue a new email. */
  @route("/resend-invitation")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_users"
  )
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-idempotency-binding",
    #[
      "operation",
      "authenticated-principal",
      "canonical-request-digest",
      "idempotency-key"
    ]
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.RotateOrgInvitation,
      Vetchium.SecurityEffect.QueueOrgInvitationEmail
    ]
  )
  resendInvitation(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: ResendInvitationRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ResendInvitationResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.OrgInvitationNotFoundErrorResponse
    | Vetchium.Problem.OrgUserLimitReachedErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Cancel up to 100 pending invitations, all or none. */
  @route("/cancel-invitations")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_users"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[Vetchium.SecurityEffect.CancelOrgInvitation]
  )
  cancelInvitations(@body request: CancelInvitationsRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.OrgInvitationNotFoundErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/get-invitation-details")
  @post
  getInvitationDetails(@body request: GetInvitationDetailsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: InvitationDetailsResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgInvitationInvalidErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Consume an invitation and create an active user without a session. */
  @route("/accept-invitation")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-idempotency-binding",
    #[
      "operation",
      "one-time-credential-identity",
      "canonical-request-digest",
      "idempotency-key"
    ]
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.ConsumeOrgInvitation,
      Vetchium.SecurityEffect.CreateOrgUser
    ]
  )
  acceptInvitation(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: AcceptInvitationRequest,
  ):
    | {
        @statusCode status_code: 201;
        @header("Cache-Control") cache_control: "no-store";
        @body body: AcceptInvitationResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgInvitationInvalidErrorResponse
    | Vetchium.Problem.OrgUserAlreadyExistsErrorResponse
    | Vetchium.Problem.OrgUserLimitReachedErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
