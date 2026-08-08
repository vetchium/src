/** The media type used for RFC 9457 problem details. */
export const MediaType = "application/problem+json";

/** RFC 9457 problem details returned by API failures. */
export interface Details {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  fields?: string[];
}

export const InternalServerError: Readonly<Details> = {
  type: "vetchium-problem-details/internal-server-error",
  title: "Internal Server Error",
  status: 500,
  detail: "Server has encountered an error",
};

export const InvalidJSONError: Readonly<Details> = {
  type: "vetchium-problem-details/invalid-json",
  title: "Invalid JSON",
  status: 400,
  detail: "Request body is not in expected JSON schema",
};

export const ValidationFailedError: Readonly<Details> = {
  type: "vetchium-problem-details/validation-failed",
  title: "Validation failed",
  status: 400,
  detail: "List of json field names in the request which failed validation",
  fields: [],
};
