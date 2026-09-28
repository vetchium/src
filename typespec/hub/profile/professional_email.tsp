import "@typespec/http";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/domain.tsp";
import "../../common/idempotency.tsp";
import "../../common/pagination.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/hub/authentication.tsp";
import "../../problem/hub/profile.tsp";
import "../operations/operations.tsp";
import "./public.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub.Profile;

/** Owner-private evidence; never part of a public or mesh profile payload. */
model ProfessionalEmail {
  id: ProfileEntryID;
  email_address: Vetchium.EmailAddress;
  domain: Vetchium.ProfessionalDomain;
  first_verified_at?: utcDateTime;
  last_verified_at?: utcDateTime;
  /** Set when a newer proof elsewhere claimed this address (GU-PEM-004):
   * verification "moved to another account" without naming who holds it
   * now. A verified address is last_verified_at set AND superseded_at
   * unset; never treat last_verified_at alone as verified. */
  superseded_at?: utcDateTime;
  created_at: utcDateTime;
}

@minValue(1)
@maxValue(10)
scalar ProfessionalEmailPageSize extends int32;

model ListProfessionalEmailsRequest {
  limit?: ProfessionalEmailPageSize = 10;
  pagination_key?: Vetchium.PaginationKey;
}

model ListProfessionalEmailsResponse {
  @maxItems(10)
  emails: ProfessionalEmail[];

  next_pagination_key?: Vetchium.PaginationKey;
}

model AddProfessionalEmailRequest {
  email_address: Vetchium.EmailAddress;
}

model ProfessionalEmailIDRequest {
  id: ProfileEntryID;
}

model ProfessionalEmailChallenge {
  challenge_id: ProfileEntryID;
  expires_at: utcDateTime;
}

model VerifyProfessionalEmailRequest {
  id: ProfileEntryID;
  challenge_id: ProfileEntryID;

  @pattern("^[0-9]{6}$")
  code: string;
}

@route("/api/hub/profile/professional-email")
@tag("Hub professional email")
interface ProfessionalEmailOperations {
  @route("/list")
  @post
  @useAuth(BearerAuth)
  list(@body request: ListProfessionalEmailsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListProfessionalEmailsResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/add")
  @post
  @useAuth(BearerAuth)
  add(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: AddProfessionalEmailRequest,
  ):
    | {
        @statusCode status_code: 201;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ProfessionalEmail;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.HubProfileConflictErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Only this explicit operation may send to the professional address. */
  @route("/request-code")
  @post
  @useAuth(BearerAuth)
  requestCode(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ProfessionalEmailIDRequest,
  ):
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ProfessionalEmailChallenge;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.HubProfileNotFoundErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** A `202` means the proof was accepted but the global claim is still
   * being applied; poll `/api/hub/operations/status`, then replay this
   * request with the same idempotency key for the resolved typed result. */
  @route("/verify")
  @post
  @useAuth(BearerAuth)
  verify(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: VerifyProfessionalEmailRequest,
  ):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Vetchium.Hub.Operations.PendingOperation;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.HubProfileNotFoundErrorResponse
    | Vetchium.Problem.HubProfessionalEmailCodeRejectedErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/delete")
  @post
  @useAuth(BearerAuth)
  delete(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ProfessionalEmailIDRequest,
  ): ProfileWriteResult | Vetchium.Problem.HubProfileNotFoundErrorResponse;
}
