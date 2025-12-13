import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

model LoginRequest {
    email: EmailAddress;
    password: Password;
}

model LoginResponse {}

@route("/hub/login")
interface Login {
    @tag("HubUsers")
    @post
    login(@body loginRequest: LoginRequest): {
        @statusCode statusCode: 200;
        @body loginResponse: LoginResponse;
    } | {
        @doc("The User account is not in a valid state to login")
        @statusCode
        statusCode: 422;
    };
}
