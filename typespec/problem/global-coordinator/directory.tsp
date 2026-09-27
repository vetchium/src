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
alias DirectoryEntryNotFoundErrorResponse = Response<
  404,
  typeof DirectoryEntryNotFoundError
>;

const DirectoryClaimConflictError = #{
  type: "vetchium-problem-details/directory-claim-conflict",
  title: "Directory claim conflict",
  status: 409,
  detail: "The requested global identity or profile slug is already claimed",
};
alias DirectoryClaimConflictErrorResponse = Response<
  409,
  typeof DirectoryClaimConflictError
>;

const DirectoryStateConflictError = #{
  type: "vetchium-problem-details/directory-state-conflict",
  title: "Directory state conflict",
  status: 409,
  detail: "The global identity is not in the required lifecycle state",
};
alias DirectoryStateConflictErrorResponse = Response<
  409,
  typeof DirectoryStateConflictError
>;

const DirectoryCallerTenantMismatchError = #{
  type: "vetchium-problem-details/directory-caller-tenant-mismatch",
  title: "Directory caller tenant mismatch",
  status: 403,
  detail: "The authenticated tenant does not own the requested global identity operation",
};
alias DirectoryCallerTenantMismatchErrorResponse = Response<
  403,
  typeof DirectoryCallerTenantMismatchError
>;

const DirectoryEmailClaimConflictError = #{
  type: "vetchium-problem-details/directory-email-claim-conflict",
  title: "Directory email claim conflict",
  status: 409,
  detail: "The email digest is already claimed by another Hub user",
};
alias DirectoryEmailClaimConflictErrorResponse = Response<
  409,
  typeof DirectoryEmailClaimConflictError
>;

const DirectoryDigestKeyMismatchError = #{
  type: "vetchium-problem-details/directory-digest-key-mismatch",
  title: "Directory digest key mismatch",
  status: 409,
  detail: "The caller's identity digest key id does not match the configured key",
};
alias DirectoryDigestKeyMismatchErrorResponse = Response<
  409,
  typeof DirectoryDigestKeyMismatchError
>;

const DirectoryReservationExpiredError = #{
  type: "vetchium-problem-details/directory-reservation-expired",
  title: "Directory reservation expired",
  status: 409,
  detail: "The email change reservation arrived after its deadline",
};
alias DirectoryReservationExpiredErrorResponse = Response<
  409,
  typeof DirectoryReservationExpiredError
>;

const DirectoryReservationCancelledError = #{
  type: "vetchium-problem-details/directory-reservation-cancelled",
  title: "Directory reservation cancelled",
  status: 409,
  detail: "The email change reservation was already abandoned",
};
alias DirectoryReservationCancelledErrorResponse = Response<
  409,
  typeof DirectoryReservationCancelledError
>;
