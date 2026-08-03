import "./details.tsp";
import "@typespec/http";

using TypeSpec.Http;

namespace Vetchium.Problem;

/** The body cannot be decoded as a JSON login request. */
@error
model InvalidJSON {
  type: "urn:vetchium:problem:invalid-json";
  title: "Invalid JSON";
  status: 400;
  detail: "The request body must contain valid JSON matching the request schema.";
}

/** The body is valid JSON but does not satisfy the request contract. */
@error
model InvalidRequest {
  type: "urn:vetchium:problem:invalid-request";
  title: "Invalid request";
  status: 400;
  detail: "One or more fields failed validation.";

  /** JSON member names that the decoder or request validation identified. */
  invalid_fields: string[];
}

union BadRequestProblem {
  invalidJSON: InvalidJSON;
  invalidRequest: InvalidRequest;
}

/** Standard 400 response for request decoding or validation failures. */
alias BadRequestResponse = {
  @statusCode status_code: 400;
  @header("Content-Type") content_type: "application/problem+json";
  @body body: BadRequestProblem;
};
