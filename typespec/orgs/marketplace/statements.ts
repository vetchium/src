import type { PaginationKey } from "../../common/pagination.ts";
import { isPaginationKey } from "../../common/pagination.ts";
import type { ApplicationNumber } from "../applications/applications.ts";
import type { OpeningNumber } from "../openings/types.ts";
import { type EngagementID, isEngagementID } from "./engagements.ts";

export type BillableFactKind =
  | "joined"
  | "separated"
  | "interview_completed"
  | "interview_no_show"
  | "assessment_result"
  | "background_check_outcome";

export const billableFactKinds: readonly BillableFactKind[] = [
  "joined",
  "separated",
  "interview_completed",
  "interview_no_show",
  "assessment_result",
  "background_check_outcome",
];

export function isBillableFactKind(value: unknown): value is BillableFactKind {
  return (
    typeof value === "string" &&
    billableFactKinds.includes(value as BillableFactKind)
  );
}

export type StatementMonth = string;

const statementMonthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isStatementMonth(value: unknown): value is StatementMonth {
  return typeof value === "string" && statementMonthPattern.test(value);
}

export interface ActivityStatementItem {
  fact_id: string;
  date: string;
  fact: BillableFactKind;
  opening_number: OpeningNumber;
  opening_title: string;
  application_number: ApplicationNumber;
  applicant_display_name: string;
  corrected: boolean;
}

export interface GetActivityStatementRequest {
  engagement_id: EngagementID;
  month: StatementMonth;
  pagination_key?: PaginationKey;
  limit?: number;
}

export function validateGetActivityStatementRequest(
  request: GetActivityStatementRequest,
): string[] {
  const fields: string[] = [];
  if (!isEngagementID(request.engagement_id)) {
    fields.push("engagement_id");
  }
  if (!isStatementMonth(request.month)) {
    fields.push("month");
  }
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  ) {
    fields.push("pagination_key");
  }
  if (
    request.limit !== undefined &&
    (!Number.isInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > 100)
  ) {
    fields.push("limit");
  }
  return fields;
}

export interface GetActivityStatementResponse {
  engagement_id: EngagementID;
  month: StatementMonth;
  items: ActivityStatementItem[];
  next_pagination_key?: PaginationKey;
}
