import "./details.tsp";

namespace Vetchium.Problem;

@error
model MalformedRequestBody {
  type: "urn:vetchium:problem:malformed-request-body";
  title: "Malformed request body";
  status: 400;
  detail: "The request body must contain one valid JSON object with no unknown fields.";
}

@error
model RequestBodyTooLarge {
  type: "urn:vetchium:problem:request-body-too-large";
  title: "Request body too large";
  status: 413;
  detail: "The request body exceeds the maximum size.";
}

@error
model InvalidLoginInput {
  type: "urn:vetchium:problem:invalid-login-input";
  title: "Invalid login input";
  status: 400;
  detail: "email_address must be valid and password must not be empty.";
}

@error
model InvalidCredentials {
  type: "urn:vetchium:problem:invalid-credentials";
  title: "Invalid credentials";
  status: 401;
  detail: "The email address or password is incorrect.";
}

/** The request did not contain the authentication identity expected by the handler. */
@error
model AuthenticationRequired {
  type: "urn:vetchium:problem:authentication-required";
  title: "Authentication required";
  status: 401;
  detail: string;
}

/** The bearer token was expired, invalidated, or otherwise no longer usable. */
@error
model InvalidSession {
  type: "urn:vetchium:problem:invalid-session";
  title: "Invalid session";
  status: 401;
  detail: string;
}
