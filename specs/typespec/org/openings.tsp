import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";
import "../common/common.tsp";
import "./company-addresses.tsp";
import "./org-users.tsp";
import "./cost-centers.tsp";
import "./tags.tsp";

using TypeSpec.Http;
namespace Vetchium;

union OpeningStatus {
  Draft:          "draft",
  PendingReview:  "pending_review",
  Published:      "published",
  Paused:         "paused",
  Expired:        "expired",
  Closed:         "closed",
  Archived:       "archived",
}

union EmploymentType {
  FullTime:   "full_time",
  PartTime:   "part_time",
  Contract:   "contract",
  Internship: "internship",
}

union WorkLocationType {
  Remote: "remote",
  OnSite: "on_site",
  Hybrid: "hybrid",
}

union EducationLevel {
  NotRequired: "not_required",
  Bachelor:    "bachelor",
  Master:      "master",
  Doctorate:   "doctorate",
}

model Salary {
  min_amount: decimal;
  max_amount: decimal;
  currency:   string;     // ISO 4217, 3 chars
}

model CreateOpeningRequest {
  title:                       string;
  description:                 string;
  is_internal:                 boolean;
  employment_type:             EmploymentType;
  work_location_type:          WorkLocationType;
  address_ids:                 string[];     // 1..10
  min_yoe?:                    int32;
  max_yoe?:                    int32;
  min_education_level?:        EducationLevel;
  salary?:                     Salary;
  number_of_positions:               int32;
  hiring_manager_email_address:      string;
  recruiter_email_address:           string;
  hiring_team_member_email_addresses?: string[];   // 0..10
  watcher_email_addresses?:            string[];   // 0..25
  cost_center_id?:                   string;
  tag_ids?:                    string[];     // 0..20
  internal_notes?:             string;       // 0..2000
}

model CreateOpeningResponse {
  opening_id:     string;
  opening_number: int32;
}

model OpeningSummary {
  opening_id:                 string;
  opening_number:             int32;
  title:                      string;
  is_internal:                boolean;
  status:                     OpeningStatus;
  employment_type:            EmploymentType;
  work_location_type:         WorkLocationType;
  number_of_positions:        int32;
  filled_positions:           int32;
  hiring_manager:             OrgUserShort;
  recruiter:                  OrgUserShort;
  primary_address_city?:      string;        // first address.city for compact list rendering
  created_at:                 utcDateTime;
  first_published_at?:        utcDateTime;
}

model Opening {
  opening_id:                 string;
  opening_number:             int32;
  title:                      string;
  description:                string;
  is_internal:                boolean;
  status:                     OpeningStatus;
  employment_type:            EmploymentType;
  work_location_type:         WorkLocationType;
  addresses:                  OrgAddress[];   // denormalized
  min_yoe?:                   int32;
  max_yoe?:                   int32;
  min_education_level?:       EducationLevel;
  salary?:                    Salary;
  number_of_positions:        int32;
  filled_positions:           int32;
  hiring_manager:             OrgUserShort;
  recruiter:                  OrgUserShort;
  hiring_team_members:        OrgUserShort[];
  watchers:                   OrgUserShort[];
  cost_center?:               CostCenter;
  tags:                       OrgTag[];
  internal_notes?:            string;
  rejection_note?:            string;
  created_at:                 utcDateTime;
  updated_at:                 utcDateTime;
  first_published_at?:        utcDateTime;
}

model UpdateOpeningRequest {
  opening_number:               int32;
  // every field from CreateOpeningRequest except is_internal
  title:                        string;
  description:                  string;
  employment_type:              EmploymentType;
  work_location_type:           WorkLocationType;
  address_ids:                  string[];
  min_yoe?:                     int32;
  max_yoe?:                     int32;
  min_education_level?:         EducationLevel;
  salary?:                      Salary;
  number_of_positions:                 int32;
  hiring_manager_email_address:        string;
  recruiter_email_address:             string;
  hiring_team_member_email_addresses?: string[];
  watcher_email_addresses?:            string[];
  cost_center_id?:              string;
  tag_ids?:                     string[];
  internal_notes?:              string;
}

model OpeningNumberRequest { opening_number: int32; }
model RejectOpeningRequest { opening_number: int32; rejection_note: string; }

model ListOpeningsRequest {
  filter_status?:                     OpeningStatus[];
  filter_is_internal?:                boolean;
  filter_hiring_manager_email_address?: string;
  filter_recruiter_email_address?:      string;
  filter_tag_ids?:                    string[];
  filter_title_prefix?:               string;
  pagination_key?:                    string;
  limit?:                             int32;
}

model ListOpeningsResponse {
  openings:             OpeningSummary[];
  next_pagination_key?: string;
}

@route("/org/create-opening")    @post createOpening   (...CreateOpeningRequest):  CreatedResponse<CreateOpeningResponse> | BadRequestResponse;
@route("/org/list-openings")     @post listOpenings    (...ListOpeningsRequest):   OkResponse<ListOpeningsResponse>      | BadRequestResponse;
@route("/org/get-opening")       @post getOpening      (...OpeningNumberRequest):  OkResponse<Opening>                   | NotFoundResponse;
@route("/org/update-opening")    @post updateOpening   (...UpdateOpeningRequest):  OkResponse<Opening>                   | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/discard-opening")   @post discardOpening  (...OpeningNumberRequest):  NoContentResponse                     | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/duplicate-opening") @post duplicateOpening(...OpeningNumberRequest):  CreatedResponse<CreateOpeningResponse>| NotFoundResponse;
@route("/org/submit-opening")    @post submitOpening   (...OpeningNumberRequest):  OkResponse<Opening>                   | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/approve-opening")   @post approveOpening  (...OpeningNumberRequest):  OkResponse<Opening>                   | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/reject-opening")    @post rejectOpening   (...RejectOpeningRequest):  OkResponse<Opening>                   | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/pause-opening")     @post pauseOpening    (...OpeningNumberRequest):  OkResponse<Opening>                   | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/reopen-opening")    @post reopenOpening   (...OpeningNumberRequest):  OkResponse<Opening>                   | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/close-opening")     @post closeOpening    (...OpeningNumberRequest):  OkResponse<Opening>                   | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/archive-opening")   @post archiveOpening  (...OpeningNumberRequest):  OkResponse<Opening>                   | NotFoundResponse | UnprocessableEntityResponse;
