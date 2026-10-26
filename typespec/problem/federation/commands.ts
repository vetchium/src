import type { Details } from "../details.ts";

export const CommandConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/federation-command-conflict",
  title: "Federation command conflict",
  status: 409,
  detail: "The command id was already used for a different command",
};

export const AuthorityMisdirectedError: Readonly<Details> = {
  type: "vetchium-problem-details/federation-authority-misdirected",
  title: "Federation authority misdirected",
  status: 421,
  detail: "The authority principal is not homed by this tenant",
};

export const AuthorityNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/federation-authority-not-found",
  title: "Federation authority not found",
  status: 404,
  detail: "The authority principal is not an active principal",
};

export const AuthorityUnavailableError: Readonly<Details> = {
  type: "vetchium-problem-details/federation-authority-unavailable",
  title: "Federation authority unavailable",
  status: 503,
  detail: "The authority tenant could not be reached; the command was not sent",
};

export const CommandOutcomeUnknownError: Readonly<Details> = {
  type: "vetchium-problem-details/federation-command-outcome-unknown",
  title: "Federation command outcome unknown",
  status: 504,
  detail: "The command was sent but its outcome is unknown",
};

export const InitiatorMismatchError: Readonly<Details> = {
  type: "vetchium-problem-details/federation-initiator-mismatch",
  title: "Federation initiator mismatch",
  status: 403,
  detail: "The initiating principal is not homed at the sending tenant",
};
