import {
  isLanguageCode,
  isTimeZoneID,
  type LanguageCode,
  type TimeZoneID,
} from "../../common/localization.ts";

export interface CompanyRegionalDefaultsResponse {
  default_language: LanguageCode;
  default_timezone: TimeZoneID;
}

export interface SetCompanyRegionalDefaultsRequest {
  default_language: LanguageCode;
  default_timezone: TimeZoneID;
}

export function validateSetCompanyRegionalDefaultsRequest(
  request: SetCompanyRegionalDefaultsRequest,
): string[] {
  const fields: string[] = [];
  if (!isLanguageCode(request.default_language)) {
    fields.push("default_language");
  }
  if (!isTimeZoneID(request.default_timezone)) {
    fields.push("default_timezone");
  }
  return fields;
}
