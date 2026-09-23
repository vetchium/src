import "../details.tsp";

namespace Vetchium.Problem;

const DirectoryAuthenticationRequiredError = #{
  type: "vetchium-problem-details/directory-authentication-required",
  title: "Directory authentication required",
  status: 401,
  detail: "A private-CA verified tenant client certificate is required",
};
alias DirectoryAuthenticationRequiredErrorResponse = AuthenticationResponse<
  "MutualTLS realm=\"global-coordinator\"",
  typeof DirectoryAuthenticationRequiredError
>;

const DirectoryEntryNotFoundError = #{
  type: "vetchium-problem-details/directory-entry-not-found",
  title: "Directory entry not found",
  status: 404,
  detail: "The requested global directory entry does not exist",
};
alias DirectoryEntryNotFoundErrorResponse = Response<404, typeof DirectoryEntryNotFoundError>;

const DirectoryClaimConflictError = #{
  type: "vetchium-problem-details/directory-claim-conflict",
  title: "Directory claim conflict",
  status: 409,
  detail: "The requested global identity or profile slug is already claimed",
};
alias DirectoryClaimConflictErrorResponse = Response<409, typeof DirectoryClaimConflictError>;

const DirectoryStateConflictError = #{
  type: "vetchium-problem-details/directory-state-conflict",
  title: "Directory state conflict",
  status: 409,
  detail: "The global identity is not in the required lifecycle state",
};
alias DirectoryStateConflictErrorResponse = Response<409, typeof DirectoryStateConflictError>;

const DirectoryCallerTenantMismatchError = #{
  type: "vetchium-problem-details/directory-caller-tenant-mismatch",
  title: "Directory caller tenant mismatch",
  status: 403,
  detail: "The authenticated tenant does not own the requested global identity operation",
};
alias DirectoryCallerTenantMismatchErrorResponse = Response<403, typeof DirectoryCallerTenantMismatchError>;
