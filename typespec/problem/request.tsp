import "./details.tsp";
import "@typespec/http";

using TypeSpec.Http;

namespace Vetchium.Problem;

/**
 * The request body exceeds the endpoint's documented size limit. This is
 * distinct from invalid JSON because the server did not inspect the complete
 * representation.
 */
@error
model RequestBodyTooLarge {
  type: "urn:vetchium:problem:request-body-too-large";
  title: "Request body too large";
  status: 413;
  detail: "The request body exceeds the maximum size.";
}

/**
 * The body is empty, truncated, malformed, contains trailing non-whitespace
 * content, or contains more than one JSON document. This problem has no field
 * list because field validation only starts after JSON parsing succeeds.
 */
@error
model InvalidJSON {
  type: "urn:vetchium:problem:invalid-json";
  title: "Invalid JSON";
  status: 400;
  detail: "The request body must contain exactly one valid JSON document.";
}

/**
 * The body is valid JSON, but its shape, member types, or business values do
 * not satisfy the request contract. Handlers collect all safely detectable
 * field failures into one occurrence rather than returning only the first.
 */
@error
model InvalidRequest {
  type: "urn:vetchium:problem:invalid-request";
  title: "Invalid request";
  status: 400;
  detail: "One or more fields failed validation.";

  /**
   * Complete invalid JSON member names, without rule-specific failure details.
   * Names use the JSON contract rather than implementation names, occur only
   * once, and are deterministic: declared members are in schema order and
   * unknown members follow in lexical order. The list is empty only when the
   * top-level request shape fails and no individual member can be identified.
   */
  invalid_fields: string[];
}

/**
 * The two mutually exclusive HTTP 400 request problems. Generated clients use
 * each variant's literal `type` URI to distinguish syntax from validation.
 */
union BadRequestProblem {
  invalidJSON: InvalidJSON;
  invalidRequest: InvalidRequest;
}

/**
 * Standard 400 response for request representation or field-validation
 * failures. Future JSON endpoints use this alias and declare both alternatives
 * so generated clients can discriminate them by their literal `type` URI.
 */
alias BadRequestResponse = {
  @statusCode status_code: 400;
  @header("Content-Type") content_type: "application/problem+json";
  @body body: BadRequestProblem;
};

/** Standard 413 response for endpoints with bounded request bodies. */
alias RequestBodyTooLargeResponse = {
  @statusCode status_code: 413;
  @header("Content-Type") content_type: "application/problem+json";
  @body body: RequestBodyTooLarge;
};
