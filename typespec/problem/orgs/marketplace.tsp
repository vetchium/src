import "../details.tsp";

namespace Vetchium.Problem;

const OrgListingPlanRequiredError = #{
  type: "vetchium-problem-details/org-listing-plan-required",
  title: "Org Listing plan required",
  status: 403,
  detail: "The Org's plan does not allow marketplace Listings",
};
alias OrgListingPlanRequiredErrorResponse = Response<
  403,
  typeof OrgListingPlanRequiredError
>;

const OrgListingNotFoundError = #{
  type: "vetchium-problem-details/org-listing-not-found",
  title: "Org Listing not found",
  status: 404,
  detail: "No Listing is readable for the requested provider and Capability",
};
alias OrgListingNotFoundErrorResponse = Response<
  404,
  typeof OrgListingNotFoundError
>;

const OrgListingExistsError = #{
  type: "vetchium-problem-details/org-listing-exists",
  title: "Org Listing exists",
  status: 409,
  detail: "The Org already has a Listing for this Capability",
};
alias OrgListingExistsErrorResponse = Response<
  409,
  typeof OrgListingExistsError
>;

const OrgListingVersionConflictError = #{
  type: "vetchium-problem-details/org-listing-version-conflict",
  title: "Org Listing version conflict",
  status: 409,
  detail: "The Listing changed since it was read",
};
alias OrgListingVersionConflictErrorResponse = Response<
  409,
  typeof OrgListingVersionConflictError
>;

const OrgListingStateConflictError = #{
  type: "vetchium-problem-details/org-listing-state-conflict",
  title: "Org Listing state conflict",
  status: 409,
  detail: "The Listing's state does not allow this action",
};
alias OrgListingStateConflictErrorResponse = Response<
  409,
  typeof OrgListingStateConflictError
>;

const OrgTenantUnavailableError = #{
  type: "vetchium-problem-details/org-tenant-unavailable",
  title: "Org tenant unavailable",
  status: 503,
  detail: "The tenant that holds the requested data did not answer in time",
};
alias OrgTenantUnavailableErrorResponse = Response<
  503,
  typeof OrgTenantUnavailableError
>;

const OrgListingNotAvailableError = #{
  type: "vetchium-problem-details/org-listing-not-available",
  title: "Org Listing not available",
  status: 409,
  detail: "The Listing is not listed or its provider cannot take engagements",
};
alias OrgListingNotAvailableErrorResponse = Response<
  409,
  typeof OrgListingNotAvailableError
>;

const OrgEngagementExistsError = #{
  type: "vetchium-problem-details/org-engagement-exists",
  title: "Org engagement exists",
  status: 409,
  detail: "A non-terminal engagement exists for the provider and Capability",
};
alias OrgEngagementExistsErrorResponse = Response<
  409,
  typeof OrgEngagementExistsError
>;

const OrgEngagementSelfError = #{
  type: "vetchium-problem-details/org-engagement-self",
  title: "Org engagement with itself",
  status: 422,
  detail: "An Org cannot engage itself",
};
alias OrgEngagementSelfErrorResponse = Response<
  422,
  typeof OrgEngagementSelfError
>;

const OrgEngagementNotFoundError = #{
  type: "vetchium-problem-details/org-engagement-not-found",
  title: "Org engagement not found",
  status: 404,
  detail: "No engagement with the requested id involves the Org",
};
alias OrgEngagementNotFoundErrorResponse = Response<
  404,
  typeof OrgEngagementNotFoundError
>;

const OrgEngagementStateConflictError = #{
  type: "vetchium-problem-details/org-engagement-state-conflict",
  title: "Org engagement state conflict",
  status: 409,
  detail: "The engagement's state does not allow this action",
};
alias OrgEngagementStateConflictErrorResponse = Response<
  409,
  typeof OrgEngagementStateConflictError
>;

const OrgEngagementVersionConflictError = #{
  type: "vetchium-problem-details/org-engagement-version-conflict",
  title: "Org engagement version conflict",
  status: 409,
  detail: "The engagement changed since it was read",
};
alias OrgEngagementVersionConflictErrorResponse = Response<
  409,
  typeof OrgEngagementVersionConflictError
>;

const OrgAssignmentExistsError = #{
  type: "vetchium-problem-details/org-assignment-exists",
  title: "Org assignment exists",
  status: 409,
  detail: "The engagement is already assigned there",
};
alias OrgAssignmentExistsErrorResponse = Response<
  409,
  typeof OrgAssignmentExistsError
>;

const OrgAssignmentNotFoundError = #{
  type: "vetchium-problem-details/org-assignment-not-found",
  title: "Org assignment not found",
  status: 404,
  detail: "The engagement is not assigned there",
};
alias OrgAssignmentNotFoundErrorResponse = Response<
  404,
  typeof OrgAssignmentNotFoundError
>;

model OrgAssignmentLimitReachedDetails {
  type: "vetchium-problem-details/org-assignment-limit-reached";
  title: "Org assignment limit reached";
  status: 409;
  detail: "No more engagements may be assigned there";
  limit: int32;
  instance?: string;
}
alias OrgAssignmentLimitReachedErrorResponse = Response<
  409,
  OrgAssignmentLimitReachedDetails
>;

const OrgEngagementCapabilityMismatchError = #{
  type: "vetchium-problem-details/org-engagement-capability-mismatch",
  title: "Org engagement Capability mismatch",
  status: 422,
  detail: "The engagement's Capability does not perform the stage kind",
};
alias OrgEngagementCapabilityMismatchErrorResponse = Response<
  422,
  typeof OrgEngagementCapabilityMismatchError
>;

const OrgEngagementWorkNotFoundError = #{
  type: "vetchium-problem-details/org-engagement-work-not-found",
  title: "Org engagement work not found",
  status: 404,
  detail: "The work item is not accessible to the provider",
};
alias OrgEngagementWorkNotFoundErrorResponse = Response<
  404,
  typeof OrgEngagementWorkNotFoundError
>;

const OrgHubUserNotFoundError = #{
  type: "vetchium-problem-details/org-hub-user-not-found",
  title: "Org Hub user not found",
  status: 404,
  detail: "No Hub user has that handle or alias",
};
alias OrgHubUserNotFoundErrorResponse = Response<
  404,
  typeof OrgHubUserNotFoundError
>;

const OrgContactLimitReachedError = #{
  type: "vetchium-problem-details/org-contact-limit-reached",
  title: "Org Contact limit reached",
  status: 429,
  detail: "The agency reached its limit of new Contacts for today",
};
alias OrgContactLimitReachedErrorResponse = Response<
  429,
  typeof OrgContactLimitReachedError
>;

const OrgContactNotFoundError = #{
  type: "vetchium-problem-details/org-contact-not-found",
  title: "Org Contact not found",
  status: 404,
  detail: "No Contact of the agency has that identifier",
};
alias OrgContactNotFoundErrorResponse = Response<
  404,
  typeof OrgContactNotFoundError
>;

const OrgContactNoteLimitReachedError = #{
  type: "vetchium-problem-details/org-contact-note-limit-reached",
  title: "Org Contact note limit reached",
  status: 409,
  detail: "The Contact already has the most notes it may hold",
};
alias OrgContactNoteLimitReachedErrorResponse = Response<
  409,
  typeof OrgContactNoteLimitReachedError
>;

const OrgContactNoteNotFoundError = #{
  type: "vetchium-problem-details/org-contact-note-not-found",
  title: "Org Contact note not found",
  status: 404,
  detail: "No note of the Contact has that identifier",
};
alias OrgContactNoteNotFoundErrorResponse = Response<
  404,
  typeof OrgContactNoteNotFoundError
>;

const OrgContactNoteNotAuthorError = #{
  type: "vetchium-problem-details/org-contact-note-not-author",
  title: "Org Contact note not author",
  status: 403,
  detail: "Only the author edits a note",
};
alias OrgContactNoteNotAuthorErrorResponse = Response<
  403,
  typeof OrgContactNoteNotAuthorError
>;

const OrgJobOwnerInvalidError = #{
  type: "vetchium-problem-details/org-job-owner-invalid",
  title: "Org Job owner invalid",
  status: 422,
  detail: "The owner is not an active user of the agency holding org:fulfil_engagements",
};
alias OrgJobOwnerInvalidErrorResponse = Response<
  422,
  typeof OrgJobOwnerInvalidError
>;

const OrgJobOwnerLimitReachedError = #{
  type: "vetchium-problem-details/org-job-owner-limit-reached",
  title: "Org Job owner limit reached",
  status: 409,
  detail: "The owner already looks after the most Jobs one user may",
};
alias OrgJobOwnerLimitReachedErrorResponse = Response<
  409,
  typeof OrgJobOwnerLimitReachedError
>;

const OrgJobOwnerVersionConflictError = #{
  type: "vetchium-problem-details/org-job-owner-version-conflict",
  title: "Org Job owner version conflict",
  status: 409,
  detail: "The Job's owner changed since it was read",
};
alias OrgJobOwnerVersionConflictErrorResponse = Response<
  409,
  typeof OrgJobOwnerVersionConflictError
>;

const OrgConversationLimitReachedError = #{
  type: "vetchium-problem-details/org-conversation-limit-reached",
  title: "Org conversation limit reached",
  status: 429,
  detail: "The agency reached its limit of new conversations for today",
};
alias OrgConversationLimitReachedErrorResponse = Response<
  429,
  typeof OrgConversationLimitReachedError
>;

const OrgConversationNotFoundError = #{
  type: "vetchium-problem-details/org-conversation-not-found",
  title: "Org conversation not found",
  status: 404,
  detail: "No conversation of the agency has that identifier",
};
alias OrgConversationNotFoundErrorResponse = Response<
  404,
  typeof OrgConversationNotFoundError
>;

const OrgAgencyMessagesOffError = #{
  type: "vetchium-problem-details/org-agency-messages-off",
  title: "Org agency messages off",
  status: 403,
  detail: "The Hub user does not accept messages from agencies",
};
alias OrgAgencyMessagesOffErrorResponse = Response<
  403,
  typeof OrgAgencyMessagesOffError
>;

const OrgConversationPartyDeletedError = #{
  type: "vetchium-problem-details/org-conversation-party-deleted",
  title: "Org conversation party deleted",
  status: 409,
  detail: "The Hub user's account no longer exists",
};
alias OrgConversationPartyDeletedErrorResponse = Response<
  409,
  typeof OrgConversationPartyDeletedError
>;
