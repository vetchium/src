import "../common/localization.tsp";
import "../orgs/marketplace/capabilities.tsp";
import "../orgs/marketplace/engagements.tsp";
import "../orgs/marketplace/work/work.tsp";
import "../orgs/types.tsp";
import "../problem/federation/commands.tsp";
import "../problem/orgs/marketplace.tsp";

namespace Vetchium.Federation.Marketplace;

/** One Org of an engagement as the consumer's tenant recorded it. */
model EngagementSnapshotOrg {
  org_did: Vetchium.Orgs.OrgDID;
  domain: Vetchium.Orgs.OrgDomain;
  display_name: string;
}

/**
 * An engagement in full: the stored `200` result of every engagement command
 * and the payload of `engagement-changed`. Consumer and provider each derive
 * their own `Engagement` view from it.
 */
model EngagementSnapshot {
  engagement_id: Vetchium.Orgs.Marketplace.EngagementID;
  version: Vetchium.Orgs.Marketplace.EngagementVersion;
  consumer: EngagementSnapshotOrg;
  provider: EngagementSnapshotOrg;
  capability: Vetchium.Orgs.Marketplace.Capability;
  state: Vetchium.Orgs.Marketplace.EngagementState;
  message?: string;
  consumer_reference?: string;
  provider_reference?: string;
  end_note?: string;
  ended_by?: Vetchium.Orgs.Marketplace.EngagementParty;
  proposed_at: utcDateTime;
  expires_at: utcDateTime;
  decided_at?: utcDateTime;
  ended_at?: utcDateTime;
  updated_at: utcDateTime;
}

/**
 * What every provider command carries: the engagement and the version the
 * provider read, the provider Org that acts (the command's initiator), its
 * current display name, and the acting user's display name. The consumer's
 * tenant records the last two in its audit event and refreshes the provider's
 * display name. The authority principal is the consumer Org and the
 * aggregate id is the engagement id.
 */
model EngagementActorPayload {
  engagement_id: Vetchium.Orgs.Marketplace.EngagementID;
  version: Vetchium.Orgs.Marketplace.EngagementVersion;
  provider_org_did: Vetchium.Orgs.OrgDID;
  provider_display_name: string;
  actor_display_name: string;
}

/** Payload of `engagement-accept` and `engagement-decline`. */
alias EngagementDecisionPayload = EngagementActorPayload;

/** Payload of `engagement-end`. */
model EngagementEndPayload {
  ...EngagementActorPayload;
  note?: string;
}

/** Payload of `engagement-set-reference`; an absent reference clears it. */
model EngagementReferencePayload {
  ...EngagementActorPayload;
  reference?: string;
}

/**
 * The deterministic rejections of the engagement commands, stored as the
 * command's outcome.
 */
alias EngagementRejections =
  | Vetchium.Problem.OrgEngagementNotFoundErrorResponse
  | Vetchium.Problem.OrgEngagementStateConflictErrorResponse
  | Vetchium.Problem.OrgEngagementVersionConflictErrorResponse
  | Vetchium.Problem.FederationInitiatorMismatchErrorResponse;

/**
 * What every provider work command carries: the work and its engagement, the
 * provider Org that acts (the command's initiator), and the acting user's
 * email address. The authority principal is the client Org and the aggregate
 * id is the work id.
 */
model WorkActor {
  engagement_id: Vetchium.Orgs.Marketplace.EngagementID;
  work_id: Vetchium.Orgs.Marketplace.Work.WorkID;
  provider_org_did: Vetchium.Orgs.OrgDID;
  actor_email: Vetchium.EmailAddress;
}

/** Payload of `work-schedule-interview`. */
model WorkScheduleInterviewPayload {
  ...WorkActor;
  ...Vetchium.Orgs.Applications.InterviewDetails;
}

/** Payload of `work-change-interview`. */
model WorkChangeInterviewPayload {
  ...WorkActor;
  interview_number: Vetchium.Orgs.Applications.InterviewNumber;
  ...Vetchium.Orgs.Applications.InterviewDetails;
}

/** Payload of `work-cancel-interview`. */
model WorkInterviewReferencePayload {
  ...WorkActor;
  interview_number: Vetchium.Orgs.Applications.InterviewNumber;
}

/** Payload of `work-record-interview-outcome`. */
model WorkInterviewOutcomePayload {
  ...WorkActor;
  interview_number: Vetchium.Orgs.Applications.InterviewNumber;
  outcome: Vetchium.Orgs.Applications.InterviewOutcome;
}

/** Payload of `work-submit-interview-feedback`; the actor is the interviewer. */
model WorkInterviewFeedbackPayload {
  ...WorkActor;
  interview_number: Vetchium.Orgs.Applications.InterviewNumber;
  recommendation: Vetchium.Orgs.Applications.InterviewRecommendation;
  notes: Vetchium.Orgs.Applications.InterviewFeedbackNotes;
}

/** Payload of `work-record-assessment`. */
model WorkAssessmentPayload {
  ...WorkActor;
  outcome: Vetchium.Orgs.Applications.AssessmentOutcome;
  score?: Vetchium.Orgs.Applications.AssessmentScore;
  notes?: Vetchium.Orgs.Applications.ResultNotes;
  report_url?: Vetchium.Hub.Profile.WebsiteURL;
}

/** Payload of `work-record-background-check-result`. */
model WorkBackgroundCheckResultPayload {
  ...WorkActor;
  check_type: Vetchium.Orgs.Hiring.CheckType;
  outcome: Vetchium.Orgs.Applications.CheckOutcome;
  notes?: Vetchium.Orgs.Applications.ResultNotes;
  report_url?: Vetchium.Hub.Profile.WebsiteURL;
}

/**
 * The deterministic rejections of the provider work commands, stored as the
 * command's outcome. A work item the provider may not reach is one answer
 * whatever the reason (MKT-ACC-004).
 */
alias WorkRejections =
  | Vetchium.Problem.OrgEngagementWorkNotFoundErrorResponse
  | Vetchium.Problem.OrgInterviewLimitReachedErrorResponse
  | Vetchium.Problem.OrgInterviewInterviewersInvalidErrorResponse
  | Vetchium.Problem.OrgInterviewNotFoundErrorResponse
  | Vetchium.Problem.OrgInterviewStateConflictErrorResponse
  | Vetchium.Problem.OrgInterviewFeedbackExistsErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.FederationInitiatorMismatchErrorResponse;
