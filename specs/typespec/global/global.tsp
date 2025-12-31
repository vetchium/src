import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// Region model
model Region {
    @doc("Region code (e.g., IND1, USA1, DEU1)")
    region_code: string;
    @doc("Human-readable region name")
    region_name: string;
}

// Supported language model
model SupportedLanguage {
    @doc("BCP 47 language code (e.g., en-US, de-DE, ta-IN)")
    language_code: string;
    @doc("Language name in English")
    language_name: string;
    @doc("Language name in its native script")
    native_name: string;
    @doc("Whether this is the default language")
    is_default: boolean;
}

// Check domain request/response
model CheckDomainRequest {
    @doc("Domain name to check if approved")
    domain: DomainName;
}

model CheckDomainResponse {
    @doc("Whether the domain is in the approved list")
    is_approved: boolean;
}

model GetRegionsResponse {
    @doc("List of available regions")
    regions: Region[];
}

model GetSupportedLanguagesResponse {
    @doc("List of supported languages")
    languages: SupportedLanguage[];
}

@route("/global")
@tag("Global")
interface Global {
    @route("/get-regions")
    @post
    @doc("Get list of available regions for user signup")
    getRegions(): {
        @statusCode statusCode: 200;
        @body response: GetRegionsResponse;
    };

    @route("/get-supported-languages")
    @post
    @doc("Get list of supported languages for the platform")
    getSupportedLanguages(): {
        @statusCode statusCode: 200;
        @body response: GetSupportedLanguagesResponse;
    };

    @route("/check-domain")
    @post
    @doc("Check if an email domain is in the approved list for professional signups")
    checkDomain(@body request: CheckDomainRequest): {
        @statusCode statusCode: 200;
        @body response: CheckDomainResponse;
    } | {
        @doc("Invalid domain format or validation errors")
        @statusCode
        statusCode: 400;
    };
}
