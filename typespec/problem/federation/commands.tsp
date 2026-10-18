import "../details.tsp";

namespace Vetchium.Problem;

const FederationCommandConflictError = #{
  type: "vetchium-problem-details/federation-command-conflict",
  title: "Federation command conflict",
  status: 409,
  detail: "The command id was already used for a different command",
};
alias FederationCommandConflictErrorResponse = Response<
  409,
  typeof FederationCommandConflictError
>;

/** The authority principal is not homed by the tenant that received the
 * command. Nothing ran; re-resolve the principal and send again. */
const FederationAuthorityMisdirectedError = #{
  type: "vetchium-problem-details/federation-authority-misdirected",
  title: "Federation authority misdirected",
  status: 421,
  detail: "The authority principal is not homed by this tenant",
};
alias FederationAuthorityMisdirectedErrorResponse = Response<
  421,
  typeof FederationAuthorityMisdirectedError
>;

const FederationAuthorityNotFoundError = #{
  type: "vetchium-problem-details/federation-authority-not-found",
  title: "Federation authority not found",
  status: 404,
  detail: "The authority principal is not an active principal",
};
alias FederationAuthorityNotFoundErrorResponse = Response<
  404,
  typeof FederationAuthorityNotFoundError
>;

/** Routing or connection setup failed, so the command was not sent. */
const FederationAuthorityUnavailableError = #{
  type: "vetchium-problem-details/federation-authority-unavailable",
  title: "Federation authority unavailable",
  status: 503,
  detail: "The authority tenant could not be reached; the command was not sent",
};
alias FederationAuthorityUnavailableErrorResponse = Response<
  503,
  typeof FederationAuthorityUnavailableError
>;

/** The command was sent but no outcome came back; it may have run. */
const FederationCommandOutcomeUnknownError = #{
  type: "vetchium-problem-details/federation-command-outcome-unknown",
  title: "Federation command outcome unknown",
  status: 504,
  detail: "The command was sent but its outcome is unknown",
};
alias FederationCommandOutcomeUnknownErrorResponse = Response<
  504,
  typeof FederationCommandOutcomeUnknownError
>;
