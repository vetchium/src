import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

model HubLoginRequest {
    email: EmailAddress;
    password: Password;
}

model HubLoginResponse {
    token: string;
}

@route("/hub/login")
interface Login {
    @tag("HubUsers")
    @post
    login(@body loginRequest: HubLoginRequest): {
        @statusCode statusCode: 200;
        @body loginResponse: HubLoginResponse;
    } | {
        @doc("The User account is not in a valid state to login")
        @statusCode
        statusCode: 422;
    } | {
        @doc("Invalid credentials")
        @statusCode
        statusCode: 401;
    };
}
