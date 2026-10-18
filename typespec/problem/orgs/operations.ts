import type { Details } from "../details.ts";

export const OperationNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-operation-not-found",
  title: "Org operation not found",
  status: 404,
  detail: "The requested operation was not found",
};
