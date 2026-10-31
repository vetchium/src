import type { ApplicationStatus } from "typespec/hub/applications/applications";

/** Ant Design preset colors, which follow the theme. */
export const statusColors: Record<ApplicationStatus, string> = {
  applied: "blue",
  in_review: "geekblue",
  interviewing: "purple",
  offered: "gold",
  offer_accepted: "cyan",
  joined: "green",
  not_selected: "default",
  declined: "default",
  withdrawn: "default",
};

/** The progress steps of an application that is moving or joined. */
export const progressStatuses = [
  "applied",
  "in_review",
  "interviewing",
  "offered",
  "offer_accepted",
  "joined",
] as const satisfies readonly ApplicationStatus[];

/** The statuses the applicant may still withdraw from. */
export const withdrawableStatuses: readonly string[] = [
  "applied",
  "in_review",
  "interviewing",
  "offered",
  "offer_accepted",
];
