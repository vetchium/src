import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";
import "../hub/work-emails.tsp";
import "../hub/connections.tsp";
import "../hub/applications.tsp";

using TypeSpec.Http;
namespace Vetchium;

model ListApplicationsRequest {
  opening_id:                string;
  filter_state?:             ApplicationState[];
  filter_label?:             ApplicationColorLabel[];
  filter_has_endorsements?:  boolean;
  filter_agency?:            string;
  pagination_key?:           string;
  limit?:                    int32;
}

model OrgApplicationSummary {
  application_id:     string;
  candidate_handle:   Handle;
  candidate_display_name: string;
  yoe_total:          int32;
  endorsement_count:  int32;
  referring_agency_domain?: string;
  ai_score?:          decimal;
  state:              ApplicationState;
  label?:             ApplicationColorLabel;
  applied_at:         utcDateTime;
}

model ListApplicationsResponse {
  applications:         OrgApplicationSummary[];
  next_pagination_key?: string;
}

model ApplicationIdRequest {
  application_id: string;
}

model OrgVisibleEndorsement {
  endorsement_id:               string;
  endorser_handle:              Handle;
  endorser_display_name:        string;
  shared_domain:                string;
  overlap_start_year:           int32;
  overlap_end_year:             int32;
  current_connection_state:     ConnectionState;
  is_referral:                  boolean;
  is_unsolicited:               boolean;
  endorser_is_current_employee: boolean;
  text:                         string;
  written_at:                   utcDateTime;
  edited_at?:                   utcDateTime;
}

model OrgApplication {
  application_id:             string;
  opening_id:                 string;
  candidate_handle:           Handle;
  candidate_display_name:     string;
  candidate_short_bio?:       string;
  candidate_employer_stints:  PublicEmployerStint[];
  cover_letter:               string;
  resume_download_url:        string;
  ai_score?:                  decimal;
  state:                      ApplicationState;
  label?:                     ApplicationColorLabel;
  applied_at:                 utcDateTime;
  state_changed_at:           utcDateTime;
  endorsements:               OrgVisibleEndorsement[];
  notify_colleagues_used:     boolean;
  referring_agency_domain?:   string;
}

model ShortlistApplicationRequest {
  application_id: string;
}

model RejectApplicationRequest {
  application_id:    string;
  rejection_reason?: string;
}

model LabelApplicationRequest {
  application_id: string;
  label?:         ApplicationColorLabel;
}

@route("/org/list-applications")
@post
op listApplications(...ListApplicationsRequest):
  OkResponse<ListApplicationsResponse> | BadRequestResponse;

@route("/org/get-application")
@post
op getApplication(...ApplicationIdRequest):
  OkResponse<OrgApplication> | NotFoundResponse;

@route("/org/shortlist-application")
@post
op shortlistApplication(...ShortlistApplicationRequest):
  OkResponse<{ candidacy_id: string }> | NotFoundResponse | UnprocessableEntityResponse;

@route("/org/reject-application")
@post
op rejectApplication(...RejectApplicationRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;

@route("/org/label-application")
@post
op labelApplication(...LabelApplicationRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;
