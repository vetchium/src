import "../common/localization.tsp";
import "../orgs/marketplace/capabilities.tsp";
import "../orgs/marketplace/engagements.tsp";
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
