import "../common/localization.tsp";
import "../hub/applications/applications.tsp";
import "../hub/profile/snapshot.tsp";
import "../hub/types.tsp";
import "../orgs/applications/applications.tsp";
import "../orgs/types.tsp";
import "../problem/federation/commands.tsp";
import "../problem/hub/applications.tsp";
import "../problem/hub/openings.tsp";

namespace Vetchium.Federation.Hiring;

/**
 * The payload of the `hub-apply` command, whose authority principal is the
 * Org and whose aggregate id is the Opening number as decimal text. The Hub
 * user's home tenant builds it from the signed-in user's own profile.
 */
model HubApplyPayload {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  applicant_did: Vetchium.Hub.HubUserDID;
  cover_note?: Vetchium.Orgs.Applications.ApplicationCoverNote;
  snapshot: Vetchium.Hub.Profile.ApplicantSnapshot;
}

/** The stored `201` result of `hub-apply`. */
model HubApplyResult {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  application_number: Vetchium.Orgs.Applications.ApplicationNumber;
}

/**
 * The deterministic rejections of `hub-apply`, stored as the command's
 * outcome: an unknown Opening, an Opening not accepting applications
 * (including one of a suspended Org), a second application, and an applicant
 * the sending tenant does not home.
 */
alias HubApplyRejections =
  | Vetchium.Problem.HubOpeningNotFoundErrorResponse
  | Vetchium.Problem.HubOpeningNotAcceptingErrorResponse
  | Vetchium.Problem.HubApplicationExistsErrorResponse
  | Vetchium.Problem.FederationInitiatorMismatchErrorResponse;

/**
 * The payload of the `hub-withdraw` command, whose authority principal is the
 * Org and whose aggregate id is the Opening number as decimal text.
 */
model HubWithdrawPayload {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  application_number: Vetchium.Orgs.Applications.ApplicationNumber;
  applicant_did: Vetchium.Hub.HubUserDID;
}

/** The stored `200` result of `hub-withdraw`. */
model HubWithdrawResult {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  application_number: Vetchium.Orgs.Applications.ApplicationNumber;
}

/**
 * The deterministic rejections of `hub-withdraw`: an application that is
 * unknown or not the applicant's, one in a state the applicant may not
 * withdraw from, and an applicant the sending tenant does not home.
 */
alias HubWithdrawRejections =
  | Vetchium.Problem.HubApplicationNotFoundErrorResponse
  | Vetchium.Problem.HubApplicationStateConflictErrorResponse
  | Vetchium.Problem.FederationInitiatorMismatchErrorResponse;

/**
 * The payload of the `hub-accept-offer` and `hub-decline-offer` commands,
 * whose authority principal is the Org and whose aggregate id is the Opening
 * number as decimal text. `offer_number` is the offer the applicant read.
 */
model HubOfferResponsePayload {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  application_number: Vetchium.Orgs.Applications.ApplicationNumber;
  offer_number: Vetchium.Orgs.Applications.OfferNumber;
  applicant_did: Vetchium.Hub.HubUserDID;
}

/** The stored `200` result of `hub-accept-offer` and `hub-decline-offer`. */
model HubOfferResponseResult {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  application_number: Vetchium.Orgs.Applications.ApplicationNumber;
  offer_number: Vetchium.Orgs.Applications.OfferNumber;
}

/**
 * The deterministic rejections of `hub-accept-offer` and
 * `hub-decline-offer`: an application that is unknown or not the
 * applicant's; one not `offered`, whose latest offer is not the named one,
 * or whose deadline passed; and an applicant the sending tenant does not
 * home.
 */
alias HubOfferResponseRejections =
  | Vetchium.Problem.HubApplicationNotFoundErrorResponse
  | Vetchium.Problem.HubApplicationStateConflictErrorResponse
  | Vetchium.Problem.FederationInitiatorMismatchErrorResponse;

/**
 * The payload of the `hub-accept-interview` command, whose authority
 * principal is the Org and whose aggregate id is the Opening number as
 * decimal text.
 */
model HubAcceptInterviewPayload {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  application_number: Vetchium.Orgs.Applications.ApplicationNumber;
  interview_number: Vetchium.Orgs.Applications.InterviewNumber;
  applicant_did: Vetchium.Hub.HubUserDID;
}

/** The payload of `hub-request-interview-reschedule`: the same, with a note. */
model HubRescheduleInterviewPayload {
  ...HubAcceptInterviewPayload;
  note: Vetchium.Orgs.Applications.InterviewRescheduleNote;
}

/** The stored `200` result of both interview-response commands. */
model HubInterviewResponseResult {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  application_number: Vetchium.Orgs.Applications.ApplicationNumber;
  interview_number: Vetchium.Orgs.Applications.InterviewNumber;
}

/**
 * The deterministic rejections of both interview-response commands: an
 * application or interview that is unknown or not the applicant's; an
 * interview that is cancelled, past, or already answered that way; and an
 * applicant the sending tenant does not home.
 */
alias HubInterviewResponseRejections =
  | Vetchium.Problem.HubApplicationNotFoundErrorResponse
  | Vetchium.Problem.HubApplicationStateConflictErrorResponse
  | Vetchium.Problem.FederationInitiatorMismatchErrorResponse;

/**
 * The payload of the `hub-give-background-check-consent` and
 * `hub-decline-background-check-consent` commands, whose authority principal
 * is the Org and whose aggregate id is the Opening number as decimal text.
 */
model HubBackgroundCheckConsentPayload {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  application_number: Vetchium.Orgs.Applications.ApplicationNumber;
  check_number: Vetchium.Orgs.Applications.BackgroundCheckNumber;
  applicant_did: Vetchium.Hub.HubUserDID;
}

/** The stored `200` result of both consent commands. */
model HubBackgroundCheckConsentResult {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  application_number: Vetchium.Orgs.Applications.ApplicationNumber;
  check_number: Vetchium.Orgs.Applications.BackgroundCheckNumber;
}

/**
 * The deterministic rejections of both consent commands: an application or
 * consent request that is unknown or not the applicant's; a request already
 * answered or ended, or a candidacy that left the pipeline; and an applicant
 * the sending tenant does not home.
 */
alias HubBackgroundCheckConsentRejections =
  | Vetchium.Problem.HubApplicationNotFoundErrorResponse
  | Vetchium.Problem.HubApplicationStateConflictErrorResponse
  | Vetchium.Problem.FederationInitiatorMismatchErrorResponse;

/**
 * The payload of the `hub-application-changed` event the Org's tenant
 * enqueues on every change of an application, for the applicant Hub user's
 * home tenant to project. Its origin is the Org: the receiver applies it only
 * when the directory homes `org_did` at the sending tenant. Its aggregate type is `org_application`, its
 * aggregate id `<org did>:<opening number>:<application number>`, and its
 * version the application's version. It carries no stage name, routing,
 * result, feedback, or Org user data.
 */
model HubApplicationChangedPayload {
  org_did: Vetchium.Orgs.OrgDID;
  org_domain: Vetchium.Orgs.OrgDomain;
  org_display_name: Vetchium.DisplayName;
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  opening_title: string;
  application_number: Vetchium.Orgs.Applications.ApplicationNumber;
  status: Vetchium.Hub.Applications.ApplicationStatus;
  pending_actions: Vetchium.Hub.Applications.PendingActionKind[];
  applied_at: utcDateTime;
  last_activity_at: utcDateTime;

  /**
   * What the event tells the applicant, when it needs an email (HP-GEN-006).
   * Absent when the applicant caused the change or nothing needs them.
   * `status_changed` emails only if the Hub status actually changed.
   */
  notice?: ApplicationNotice;
}

/**
 * Why an application changed, for the applicant's notification email. It
 * names no interview, offer, or result content.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #[
    "status_changed",
    "interview_scheduled",
    "interview_changed",
    "interview_cancelled",
    "consent_requested",
    "offer_extended",
    "offer_withdrawn",
    "offer_expiring",
    "offer_expired"
  ]
)
scalar ApplicationNotice extends string;

/**
 * The payload of the `hub-application-removed` event the Org's tenant
 * enqueues when retention removes an application (HP-RET-001), for the
 * applicant's home tenant to delete the projection row. Origin, aggregate
 * type, and aggregate id are those of `hub-application-changed`; its version
 * is the application's version after removal.
 */
model HubApplicationRemovedPayload {
  org_did: Vetchium.Orgs.OrgDID;
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  application_number: Vetchium.Orgs.Applications.ApplicationNumber;
}
