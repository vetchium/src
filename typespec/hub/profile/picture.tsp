import "@typespec/http";

import "../../common/authentication.tsp";
import "../../common/idempotency.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/hub/authentication.tsp";
import "../../problem/hub/profile.tsp";
import "../../problem/hub/subscriptions.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub.Profile;

alias PictureContentType = "image/jpeg" | "image/png";

@route("/api/hub/profile/picture")
@tag("Hub profile picture")
interface PictureOperations {
  @route("/upload")
  @post
  @useAuth(BearerAuth)
  upload(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @header("Content-Type") content_type: PictureContentType,

    /** Reject before decoding when the request exceeds 8,388,608 bytes. */
    @body body: bytes,
  ):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.HubPlanRequiredErrorResponse
    | Vetchium.Problem.HubProfilePictureTooLargeErrorResponse
    | Vetchium.Problem.HubProfilePictureInvalidErrorResponse
    | Vetchium.Problem.HubProfileConflictErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/remove")
  @post
  @useAuth(BearerAuth)
  remove(@header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
