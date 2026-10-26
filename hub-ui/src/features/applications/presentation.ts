import type {
  ApplicationStatus,
  MyApplicationSummary,
} from "typespec/hub/applications/applications";

export const closedStatuses: readonly string[] = [
  "hired",
  "not_progressing",
  "withdrawn",
];

export function isClosed(application: MyApplicationSummary): boolean {
  return closedStatuses.includes(application.status);
}

/** Ant Design preset colors, which follow the theme. */
export const statusColors: Record<ApplicationStatus, string> = {
  applied: "blue",
  in_review: "geekblue",
  interviewing: "purple",
  offer: "gold",
  hired: "green",
  not_progressing: "default",
  withdrawn: "default",
};

/** The progress steps of an application that is still moving. */
export const progressStatuses = [
  "applied",
  "in_review",
  "interviewing",
  "offer",
  "hired",
] as const satisfies readonly ApplicationStatus[];
