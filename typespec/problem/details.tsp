import "@typespec/http";

using TypeSpec.Http;

/**
 * RFC 9457 problem contracts shared by every Vetchium HTTP API.
 *
 * The `type` URI is the stable machine-readable error code. Clients must
 * identify problems by `type` and must not parse `title` or `detail`.
 * Vetchium-specific semantics use a stable `urn:vetchium:problem:*` type;
 * `about:blank` is reserved for failures fully described by their HTTP status.
 */
namespace Vetchium.Problem;

/** RFC 9457 problem details returned by API failures. */
model Details {
  /**
   * The stable machine-readable error code. Clients switch on this URI; a
   * separate `code` member is intentionally not part of Vetchium problems.
   */
  type: string;

  /** A stable human-readable summary that clients must not parse. */
  title: string;

  /** The HTTP status code returned with this occurrence. */
  status: int32;

  /**
   * Safe human-readable guidance that clients must not parse. It never exposes
   * implementation, authentication, or database details.
   */
  detail?: string;

  /** A URI identifying this particular occurrence, when available. */
  instance?: string;
}

/** An unexpected server failure that does not expose internal details. */
@error
model InternalServerError {
  type: "about:blank";
  title: "Internal Server Error";
  status: 500;
  detail: "The request could not be completed.";
}

/**
 * Standard response envelope for an unexpected server failure. Future APIs
 * use this alias so the status, media type, and defensive header stay uniform.
 */
alias InternalServerErrorResponse = {
  @statusCode status_code: 500;
  @header("Content-Type") content_type: "application/problem+json";
  @body body: InternalServerError;
};
