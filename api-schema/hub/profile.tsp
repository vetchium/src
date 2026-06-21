import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";
import "./hub-users.tsp";

using TypeSpec.Http;
namespace Vetchium;

model HubProfileOwnerView {
  handle:                  Handle;
  display_names:           DisplayNameEntry[];
  short_bio?:              string;
  long_bio?:               string;
  city?:                   string;
  resident_country_code?:  CountryCode;
  has_profile_picture:     boolean;
  preferred_language:      LanguageCode;
  created_at:              utcDateTime;
  updated_at:              utcDateTime;
}

model HubProfilePublicView {
  handle:                  Handle;
  display_names:           DisplayNameEntry[];
  short_bio?:              string;
  long_bio?:               string;
  city?:                   string;
  resident_country_code?:  CountryCode;
  profile_picture_url?:    string;
}

model UpdateMyProfileRequest {
  display_names?:          DisplayNameEntry[];
  short_bio?:              string;
  long_bio?:               string;
  city?:                   string;
  resident_country_code?:  CountryCode;
}

model GetProfileRequest { handle: Handle; }

@route("/hub/get-my-profile")           @get  getMyProfile():                                            OkResponse<HubProfileOwnerView>;
@route("/hub/update-my-profile")        @post updateMyProfile     (@body body: UpdateMyProfileRequest):  OkResponse<HubProfileOwnerView> | BadRequestResponse;
@route("/hub/upload-profile-picture")   @post uploadProfilePicture(@bodyRoot form: { image: bytes }):   OkResponse<HubProfileOwnerView> | BadRequestResponse;
@route("/hub/remove-profile-picture")   @post removeProfilePicture():                                   OkResponse<HubProfileOwnerView>;
@route("/hub/get-profile")              @post getProfile          (@body body: GetProfileRequest):       OkResponse<HubProfilePublicView> | NotFoundResponse;
@route("/hub/profile-picture/{handle}") @get  getProfilePicture   (@path handle: Handle):               { @statusCode statusCode: 200; @header contentType: string; @body image: bytes; } | NotFoundResponse;
