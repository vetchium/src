namespace Vetchium.Problem;

/** RFC 9457 problem details returned by API failures. */
model Details {
  /** A stable URI identifying the problem type. */
  type: string;

  /** A stable, human-readable summary of the problem type. */
  title: string;

  /** The HTTP status code returned with this occurrence. */
  status: int32;

  /** A human-readable explanation specific to this occurrence. */
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
