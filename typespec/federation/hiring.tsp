import "../hub/profile/snapshot.tsp";
import "../hub/types.tsp";
import "../orgs/applications/applications.tsp";
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
 * (including one of a suspended Org), and a second application.
 */
alias HubApplyRejections =
  | Vetchium.Problem.HubOpeningNotFoundErrorResponse
  | Vetchium.Problem.HubOpeningNotAcceptingErrorResponse
  | Vetchium.Problem.HubApplicationExistsErrorResponse;
