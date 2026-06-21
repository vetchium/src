import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

union WorkEmailStintStatus {
  PendingVerification: "pending_verification",
  Active:              "active",
  Ended:               "ended",
}

union WorkEmailStintEndedReason {
  UserRemoved:         "user_removed",
  UserRemovedPending:  "user_removed_pending",
  VerificationExpired: "verification_expired",
  ReverifyTimeout:     "reverify_timeout",
  Superseded:          "superseded",
}

model WorkEmailStintOwnerView {
  stint_id:                         string;
  email_address:                    string;
  domain:                           string;
  status:                           WorkEmailStintStatus;
  first_verified_at?:               utcDateTime;
  last_verified_at?:                utcDateTime;
  ended_at?:                        utcDateTime;
  ended_reason?:                    WorkEmailStintEndedReason;
  pending_code_expires_at?:         utcDateTime;
  pending_code_attempts_remaining?: int32;
  reverify_challenge_issued_at?:    utcDateTime;
  reverify_challenge_expires_at?:   utcDateTime;
  created_at:                       utcDateTime;
  updated_at:                       utcDateTime;
}

model PublicEmployerStint {
  domain:     string;
  is_current: boolean;
  start_year: int32;
  end_year?:  int32;
}

model AddWorkEmailRequest        { email_address: string; }
model AddWorkEmailResponse       { stint_id: string; pending_code_expires_at: utcDateTime; }
model VerifyWorkEmailRequest     { stint_id: string; code: string; }
model ResendWorkEmailCodeRequest { stint_id: string; }
model ReverifyWorkEmailRequest   { stint_id: string; code: string; }
model RemoveWorkEmailRequest     { stint_id: string; }
model GetMyWorkEmailRequest      { stint_id: string; }

model ListMyWorkEmailsRequest {
  filter_status?:  WorkEmailStintStatus[];
  filter_domain?:  string;
  pagination_key?: string;
  limit?:          int32;
}

model ListMyWorkEmailsResponse {
  work_emails:          WorkEmailStintOwnerView[];
  next_pagination_key?: string;
}

model ListPublicEmployerStintsRequest  { handle: string; }
model ListPublicEmployerStintsResponse { stints: PublicEmployerStint[]; }

@route("/hub/add-work-email")
@post
op addWorkEmail(...AddWorkEmailRequest): {
  @statusCode statusCode: 201;
  @body body: AddWorkEmailResponse;
} | BadRequestResponse | ConflictResponse | {
  @statusCode statusCode: 422;
};

@route("/hub/verify-work-email")
@post
op verifyWorkEmail(...VerifyWorkEmailRequest): {
  @statusCode statusCode: 200;
  @body body: WorkEmailStintOwnerView;
} | BadRequestResponse | NotFoundResponse | {
  @statusCode statusCode: 422;
};

@route("/hub/resend-work-email-code")
@post
op resendWorkEmailCode(...ResendWorkEmailCodeRequest): {
  @statusCode statusCode: 200;
  @body body: WorkEmailStintOwnerView;
} | BadRequestResponse | NotFoundResponse | {
  @statusCode statusCode: 429;
} | {
  @statusCode statusCode: 422;
};

@route("/hub/reverify-work-email")
@post
op reverifyWorkEmail(...ReverifyWorkEmailRequest): {
  @statusCode statusCode: 200;
  @body body: WorkEmailStintOwnerView;
} | BadRequestResponse | NotFoundResponse | {
  @statusCode statusCode: 422;
};

@route("/hub/remove-work-email")
@post
op removeWorkEmail(...RemoveWorkEmailRequest): {
  @statusCode statusCode: 200;
  @body body: WorkEmailStintOwnerView;
} | NotFoundResponse | {
  @statusCode statusCode: 422;
};

@route("/hub/list-my-work-emails")
@post
op listMyWorkEmails(...ListMyWorkEmailsRequest): {
  @statusCode statusCode: 200;
  @body body: ListMyWorkEmailsResponse;
} | BadRequestResponse;

@route("/hub/get-my-work-email")
@post
op getMyWorkEmail(...GetMyWorkEmailRequest): {
  @statusCode statusCode: 200;
  @body body: WorkEmailStintOwnerView;
} | NotFoundResponse;

@route("/hub/list-public-employer-stints")
@post
op listPublicStints(...ListPublicEmployerStintsRequest): {
  @statusCode statusCode: 200;
  @body body: ListPublicEmployerStintsResponse;
};
