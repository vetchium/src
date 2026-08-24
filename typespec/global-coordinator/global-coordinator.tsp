import "@typespec/http";

import "../problem/details.tsp";
import "../problem/global-coordinator/authentication.tsp";

using TypeSpec.Http;

namespace Vetchium.GlobalCoordinator;

/**
 * A globally unique, fixed-width identifier. The alphabet omits i, l, o, and
 * u so identifiers are easier to read and transcribe. This is not a DID.
 */
@minLength(11)
@maxLength(11)
@pattern("^[0-9a-hjkmnp-tv-z]{11}$")
scalar ShortID extends string;

model GenerateShortIDResponse {
  short_id: ShortID;
}

@route("/api/global-coordinator")
@tag("Global coordinator")
interface Operations {
  /** Allocate one globally unique short identifier. */
  @route("/generate-short-id")
  @post
  @useAuth(BearerAuth)
  generateShortID():
    | {
        @statusCode status_code: 201;
        @header("Cache-Control") cache_control: "no-store";
        @body body: GenerateShortIDResponse;
      }
    | Vetchium.Problem.GlobalCoordinatorAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
