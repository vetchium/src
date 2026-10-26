import "../common/localization.tsp";
import "../hub/types.tsp";
import "../orgs/marketplace/capabilities.tsp";
import "../orgs/marketplace/contacts/contacts.tsp";
import "../orgs/marketplace/engagements.tsp";
import "../orgs/marketplace/work/work.tsp";
import "../orgs/openings/types.tsp";
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

/**
 * The payload of `agency-pointer-changed`, which the agency's tenant enqueues
 * for the Hub user's home tenant when it creates a Contact (`present`) or
 * deletes one. The tenant keeps one agency pointer per Contact and never
 * returns it from any Hub API (MKT-DAT-003). The aggregate is the Contact and
 * its version is the Contact's pointer version; the origin is the agency Org.
 */
model AgencyPointerChangedPayload {
  contact_id: Vetchium.Orgs.Marketplace.Contacts.ContactID;
  agency_org_did: Vetchium.Orgs.OrgDID;
  hub_user_did: Vetchium.Hub.HubUserDID;
  present: boolean;
  has_conversation?: boolean;
  agency_display_name?: string;
  agency_domain?: Vetchium.Orgs.OrgDomain;
  last_activity_at?: utcDateTime;
  read_only_reason?: Vetchium.Orgs.Marketplace.Contacts.ConversationReadOnlyReason;
  suggestions?: AgencyPointerSuggestion[];
  new_agency_message?: boolean;
}

/** An Opening the agency suggested in the conversation, as the pointer keeps it. */
model AgencyPointerSuggestion {
  consumer_domain: Vetchium.Orgs.OrgDomain;
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  sent_at: utcDateTime;
}

/** Payload of `hub-conversation-reply`. */
model HubConversationReplyPayload {
  contact_id: Vetchium.Orgs.Marketplace.Contacts.ContactID;
  hub_user_did: Vetchium.Hub.HubUserDID;

  /** The Hub user's name and handle now, which the agency records (MKT-CNV-001). */
  hub_user_display_name: Vetchium.DisplayName;

  hub_user_handle: Vetchium.Hub.HubHandle;
  text: Vetchium.Orgs.Marketplace.Contacts.MessageText;
}

/** Payload of `hub-conversation-delete`. */
model HubConversationDeletePayload {
  contact_id: Vetchium.Orgs.Marketplace.Contacts.ContactID;
  hub_user_did: Vetchium.Hub.HubUserDID;
}

model MeshReadConversationRequest {
  contact_id: Vetchium.Orgs.Marketplace.Contacts.ContactID;
  hub_user_did: Vetchium.Hub.HubUserDID;
  agency_org_did: Vetchium.Orgs.OrgDID;
  pagination_key?: Vetchium.PaginationKey;
  limit?: Vetchium.Orgs.Marketplace.Contacts.ContactPageSize = 50;
}

/**
 * One page of a conversation as the Hub user reads it. Agency messages name
 * the agency, never the agency user; no agency-side unread state is carried.
 */
model MeshReadConversationResponse {
  read_only_reason?: Vetchium.Orgs.Marketplace.Contacts.ConversationReadOnlyReason;
  messages: Vetchium.Orgs.Marketplace.Contacts.ConversationMessage[];
  next_pagination_key?: Vetchium.PaginationKey;
}

/**
 * The payload of `hub-account-deleted`, the deletion notice a Hub user's home
 * tenant sends an agency Org (MKT-DAT-012, MKT-DAT-013): the account the
 * agency's pointer named does not exist. The agency's tenant deletes the
 * notes on that person. The origin is the Hub user.
 */
model HubAccountDeletedPayload {
  hub_user_did: Vetchium.Hub.HubUserDID;
}

/**
 * The payload of `hub-agency-messages-changed`: the state of "Agencies may
 * message me" the agency's Contact on the Hub user keeps (MKT-DAT-006). The
 * aggregate is the Contact and its version is the setting's version, so a
 * Contact created later still receives the state; the origin is the Hub user.
 */
model HubAgencyMessagesChangedPayload {
  contact_id: Vetchium.Orgs.Marketplace.Contacts.ContactID;
  hub_user_did: Vetchium.Hub.HubUserDID;
  messages_off: boolean;
}
