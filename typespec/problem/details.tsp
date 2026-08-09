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

/** An RFC 9457 response with a stable problem body. */
alias Response<Status extends int32, Body extends Details> = {
  @statusCode status_code: Status;
  @header("Content-Type") content_type: "application/problem+json";
  @body body: Body;
};

/** A 401 RFC 9457 response carrying its required authentication challenge. */
alias AuthenticationResponse<Challenge extends string, Body extends Details> = {
  @statusCode status_code: 401;
  @header("WWW-Authenticate") www_authenticate: Challenge;
  @header("Content-Type") content_type: "application/problem+json";
  @body body: Body;
};

const InternalServerError = #{
  type: "vetchium-problem-details/internal-server-error",
  title: "Internal Server Error",
  status: 500,
  detail: "Server has encountered an error",
};

alias InternalServerErrorResponse = Response<500, typeof InternalServerError>;

const InvalidJSONError = #{
  type: "vetchium-problem-details/invalid-json",
  title: "Invalid JSON",
  status: 400,
  detail: "Request body is not in expected JSON schema",
};

alias InvalidJSONErrorResponse = Response<400, typeof InvalidJSONError>;

model ValidationFailedDetails {
  type: "vetchium-problem-details/validation-failed";
  title: "Validation failed";
  status: 400;
  detail: "List of json field names in the request which failed validation";

  @minItems(1)
  fields: string[];

  instance?: string;
}

alias ValidationFailedErrorResponse = Response<400, ValidationFailedDetails>;
