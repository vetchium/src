import "@typespec/http";

using TypeSpec.Http;

namespace Vetchium.Problem;

/** RFC 9457 problem details returned by API failures. */
model Details {
  type: string;
  title: string;
  status: int32;
  detail?: string;
  instance?: string;
  fields?: string[];
}

const InternalServerError: Details = #{
  type: "vetchium-problem-details/internal-server-error",
  title: "Internal Server Error",
  status: 500,
  detail: "Server has encountered an error",
};

alias InternalServerErrorResponse = {
  @statusCode status_code: 500;
  @header("Content-Type") content_type: "application/problem+json";
  @body body: typeof InternalServerError;
};

const InvalidJSONError: Details = #{
  type: "vetchium-problem-details/invalid-json",
  title: "Invalid JSON",
  status: 400,
  detail: "Request body is not in expected JSON schema",
};

alias InvalidJSONErrorResponse = {
  @statusCode status_code: 400;
  @header("Content-Type") content_type: "application/problem+json";
  @body body: typeof InvalidJSONError;
};

const ValidationFailedError: Details = #{
  type: "vetchium-problem-details/validation-failed",
  title: "Validation failed",
  status: 400,
  detail: "List of json field names in the request which failed validation",
  fields: #[],
};

alias ValidationFailedErrorResponse = {
  @statusCode status_code: 400;
  @header("Content-Type") content_type: "application/problem+json";
  @body body: typeof ValidationFailedError;
};
