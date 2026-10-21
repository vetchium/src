import type { Details } from "../details.ts";

export const ListingPlanRequiredError: Readonly<Details> = {
  type: "vetchium-problem-details/org-listing-plan-required",
  title: "Org Listing plan required",
  status: 403,
  detail: "The Org's plan does not allow marketplace Listings",
};

export const ListingNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-listing-not-found",
  title: "Org Listing not found",
  status: 404,
  detail: "No Listing is readable for the requested provider and Capability",
};

export const ListingExistsError: Readonly<Details> = {
  type: "vetchium-problem-details/org-listing-exists",
  title: "Org Listing exists",
  status: 409,
  detail: "The Org already has a Listing for this Capability",
};

export const ListingVersionConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/org-listing-version-conflict",
  title: "Org Listing version conflict",
  status: 409,
  detail: "The Listing changed since it was read",
};

export const ListingStateConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/org-listing-state-conflict",
  title: "Org Listing state conflict",
  status: 409,
  detail: "The Listing's state does not allow this action",
};

export const TenantUnavailableError: Readonly<Details> = {
  type: "vetchium-problem-details/org-tenant-unavailable",
  title: "Org tenant unavailable",
  status: 503,
  detail: "The tenant that holds the requested data did not answer in time",
};

export const ListingNotAvailableError: Readonly<Details> = {
  type: "vetchium-problem-details/org-listing-not-available",
  title: "Org Listing not available",
  status: 409,
  detail: "The Listing is not listed or its provider cannot take engagements",
};

export const EngagementExistsError: Readonly<Details> = {
  type: "vetchium-problem-details/org-engagement-exists",
  title: "Org engagement exists",
  status: 409,
  detail: "A non-terminal engagement exists for the provider and Capability",
};

export const EngagementSelfError: Readonly<Details> = {
  type: "vetchium-problem-details/org-engagement-self",
  title: "Org engagement with itself",
  status: 422,
  detail: "An Org cannot engage itself",
};

export const EngagementNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-engagement-not-found",
  title: "Org engagement not found",
  status: 404,
  detail: "No engagement with the requested id involves the Org",
};

export const EngagementStateConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/org-engagement-state-conflict",
  title: "Org engagement state conflict",
  status: 409,
  detail: "The engagement's state does not allow this action",
};

export const EngagementVersionConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/org-engagement-version-conflict",
  title: "Org engagement version conflict",
  status: 409,
  detail: "The engagement changed since it was read",
};

export const AssignmentExistsError: Readonly<Details> = {
  type: "vetchium-problem-details/org-assignment-exists",
  title: "Org assignment exists",
  status: 409,
  detail: "The engagement is already assigned there",
};

export const AssignmentNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-assignment-not-found",
  title: "Org assignment not found",
  status: 404,
  detail: "The engagement is not assigned there",
};

export interface AssignmentLimitReachedDetails extends Details {
  type: "vetchium-problem-details/org-assignment-limit-reached";
  limit: number;
}

export const EngagementCapabilityMismatchError: Readonly<Details> = {
  type: "vetchium-problem-details/org-engagement-capability-mismatch",
  title: "Org engagement Capability mismatch",
  status: 422,
  detail: "The engagement's Capability does not perform the stage kind",
};

export const EngagementWorkNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-engagement-work-not-found",
  title: "Org engagement work not found",
  status: 404,
  detail: "The work item is not accessible to the provider",
};

export const HubUserNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-hub-user-not-found",
  title: "Org Hub user not found",
  status: 404,
  detail: "No Hub user has that handle or alias",
};

export const ContactLimitReachedError: Readonly<Details> = {
  type: "vetchium-problem-details/org-contact-limit-reached",
  title: "Org Contact limit reached",
  status: 429,
  detail: "The agency reached its limit of new Contacts for today",
};

export const ContactNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-contact-not-found",
  title: "Org Contact not found",
  status: 404,
  detail: "No Contact of the agency has that identifier",
};

export const ContactNoteLimitReachedError: Readonly<Details> = {
  type: "vetchium-problem-details/org-contact-note-limit-reached",
  title: "Org Contact note limit reached",
  status: 409,
  detail: "The Contact already has the most notes it may hold",
};

export const ContactNoteNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-contact-note-not-found",
  title: "Org Contact note not found",
  status: 404,
  detail: "No note of the Contact has that identifier",
};

export const ContactNoteNotAuthorError: Readonly<Details> = {
  type: "vetchium-problem-details/org-contact-note-not-author",
  title: "Org Contact note not author",
  status: 403,
  detail: "Only the author edits a note",
};

export const ConversationLimitReachedError: Readonly<Details> = {
  type: "vetchium-problem-details/org-conversation-limit-reached",
  title: "Org conversation limit reached",
  status: 429,
  detail: "The agency reached its limit of new conversations for today",
};

export const ConversationNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-conversation-not-found",
  title: "Org conversation not found",
  status: 404,
  detail: "No conversation of the agency has that identifier",
};

export const AgencyMessagesOffError: Readonly<Details> = {
  type: "vetchium-problem-details/org-agency-messages-off",
  title: "Org agency messages off",
  status: 403,
  detail: "The Hub user does not accept messages from agencies",
};

export const ConversationPartyDeletedError: Readonly<Details> = {
  type: "vetchium-problem-details/org-conversation-party-deleted",
  title: "Org conversation party deleted",
  status: 409,
  detail: "The Hub user's account no longer exists",
};
