import "@typespec/http";
import "@typespec/openapi";

import "../../../common/authentication.tsp";
import "../../../common/domain.tsp";
import "../../../common/idempotency.tsp";
import "../../../common/localization.tsp";
import "../../../common/pagination.tsp";
import "../../../hub/profile/public.tsp";
import "../../../hub/types.tsp";
import "../../../problem/common.tsp";
import "../../../problem/details.tsp";
import "../../../problem/orgs/authentication.tsp";
import "../../../problem/orgs/marketplace.tsp";
import "../../../problem/orgs/suspension.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs.Marketplace.Contacts;

/** Names one Contact of an agency; never reused. */
@format("uuid")
scalar ContactID extends string;

@format("uuid")
scalar ContactNoteID extends string;

/** Plain text, 1–5,000 code points after trimming. */
@maxLength(20000)
scalar NoteText extends string;

@minValue(1)
@maxValue(100)
scalar ContactPageSize extends int32;

/**
 * A verified professional-email domain with the months of its first and last
 * verification. Never an address, a local part, or an exact instant.
 */
model VerifiedDomain {
  domain: Vetchium.ProfessionalDomain;
  first_verified_month: Vetchium.Hub.Profile.ProfileMonth;
  last_verified_month: Vetchium.Hub.Profile.ProfileMonth;
}

/** One Contact in a list or beside a profile. */
model ContactSummary {
  contact_id: ContactID;

  /** As last read from the person's profile. */
  display_name: Vetchium.DisplayName;

  handle: Vetchium.Hub.HubHandle;

  /** The person does not accept messages from agencies. */
  messages_off: boolean;

  note_count: int32;
  last_activity_at: utcDateTime;
}

model Contact {
  ...ContactSummary;

  /** The email address of the agency user who created the Contact. */
  created_by: Vetchium.EmailAddress;

  created_at: utcDateTime;
}

model ContactNote {
  note_id: ContactNoteID;

  /** The email address of the agency user who wrote it. */
  author: Vetchium.EmailAddress;

  /** The caller wrote it, so the caller may edit it. */
  mine: boolean;

  text: NoteText;
  created_at: utcDateTime;
  edited_at?: utcDateTime;
}

/**
 * A Hub user's profile as an agency sees it: the public profile plus each
 * verified professional-email domain, and the agency's Contact when it has
 * one.
 */
model AgencyProfile {
  profile: Vetchium.Hub.Profile.PublicProfile;
  verified_domains: VerifiedDomain[];
  contact?: ContactSummary;
}

model ViewHubProfileRequest {
  address: Vetchium.Hub.Profile.ProfileAddress;
}

model ListContactsRequest {
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: ContactPageSize = 50;
}

model ListContactsResponse {
  items: ContactSummary[];
  next_pagination_key?: Vetchium.PaginationKey;
}

model ContactReference {
  contact_id: ContactID;
}

model ListContactNotesRequest {
  contact_id: ContactID;
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: ContactPageSize = 50;
}

model ListContactNotesResponse {
  items: ContactNote[];
  next_pagination_key?: Vetchium.PaginationKey;
}

/**
 * Writes a note on the person at `address`, creating the Contact if the
 * agency has none.
 */
model AddPersonNoteRequest {
  address: Vetchium.Hub.Profile.ProfileAddress;
  text: NoteText;
}

model AddContactNoteRequest {
  contact_id: ContactID;
  text: NoteText;
}

/** The note written and the Contact it belongs to. */
model AddedNote {
  contact: ContactSummary;
  note: ContactNote;
}

model EditContactNoteRequest {
  contact_id: ContactID;
  note_id: ContactNoteID;
  text: NoteText;
}

model DeleteContactNoteRequest {
  contact_id: ContactID;
  note_id: ContactNoteID;
}

model DeletedNote {
  /** The note was the Contact's last, and the Contact went with it. */
  contact_deleted: boolean;
}

alias ContactReadErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
  | Vetchium.Problem.OrgPermissionRequiredErrorResponse
  | Vetchium.Problem.OrgSuspendedErrorResponse
  | Vetchium.Problem.RateLimitExceededErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias ContactWriteErrors =
  | ContactReadErrors
  | Vetchium.Problem.IdempotencyKeyConflictErrorResponse;

@route("/api/orgs")
@tag("Org agency Contacts")
interface ContactOperations {
  /**
   * Reads a Hub user's profile by handle or alias, with each verified
   * professional-email domain, and records nothing about the view.
   */
  @route("/view-hub-profile")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  viewHubProfile(@body request: ViewHubProfileRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: AgencyProfile;
      }
    | ContactReadErrors
    | Vetchium.Problem.OrgHubUserNotFoundErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse;

  /** Lists the agency's Contacts, most recent activity first. */
  @route("/list-contacts")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  listContacts(@body request: ListContactsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListContactsResponse;
      }
    | ContactReadErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

  @route("/get-contact")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  getContact(@body request: ContactReference):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Contact;
      }
    | ContactReadErrors
    | Vetchium.Problem.OrgContactNotFoundErrorResponse;

  /** Lists a Contact's notes, newest first. */
  @route("/list-contact-notes")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  listContactNotes(@body request: ListContactNotesRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListContactNotesResponse;
      }
    | ContactReadErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse
    | Vetchium.Problem.OrgContactNotFoundErrorResponse;

  /**
   * Writes a note on a person by handle or alias. The first note on a person
   * creates the agency's Contact, within the daily limit of new Contacts and
   * only while the agency has a listed `sourcing` Listing.
   */
  @route("/add-person-note")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-idempotency-binding",
    #[
      "operation",
      "authenticated-principal",
      "canonical-request-digest",
      "idempotency-key"
    ]
  )
  addPersonNote(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: AddPersonNoteRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: AddedNote;
      }
    | ContactWriteErrors
    | Vetchium.Problem.OrgHubUserNotFoundErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse
    | Vetchium.Problem.OrgListingNotAvailableErrorResponse
    | Vetchium.Problem.OrgContactLimitReachedErrorResponse
    | Vetchium.Problem.OrgContactNoteLimitReachedErrorResponse;

  /** Writes a note on one of the agency's Contacts. */
  @route("/add-contact-note")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-idempotency-binding",
    #[
      "operation",
      "authenticated-principal",
      "canonical-request-digest",
      "idempotency-key"
    ]
  )
  addContactNote(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: AddContactNoteRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: AddedNote;
      }
    | ContactWriteErrors
    | Vetchium.Problem.OrgContactNotFoundErrorResponse
    | Vetchium.Problem.OrgContactNoteLimitReachedErrorResponse;

  /** Replaces the text of a note its author wrote. */
  @route("/edit-contact-note")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-idempotency-binding",
    #[
      "operation",
      "authenticated-principal",
      "canonical-request-digest",
      "idempotency-key"
    ]
  )
  editContactNote(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: EditContactNoteRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ContactNote;
      }
    | ContactWriteErrors
    | Vetchium.Problem.OrgContactNotFoundErrorResponse
    | Vetchium.Problem.OrgContactNoteNotFoundErrorResponse
    | Vetchium.Problem.OrgContactNoteNotAuthorErrorResponse;

  /**
   * Deletes a note; any agency user may. Deleting the last note of a Contact
   * without a conversation deletes the Contact.
   */
  @route("/delete-contact-note")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-idempotency-binding",
    #[
      "operation",
      "authenticated-principal",
      "canonical-request-digest",
      "idempotency-key"
    ]
  )
  deleteContactNote(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: DeleteContactNoteRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: DeletedNote;
      }
    | ContactWriteErrors
    | Vetchium.Problem.OrgContactNotFoundErrorResponse
    | Vetchium.Problem.OrgContactNoteNotFoundErrorResponse;
}
