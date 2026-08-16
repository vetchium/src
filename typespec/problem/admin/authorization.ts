import type { Details } from "../details.ts";

export const AdminPermissionRequiredError: Readonly<Details> = {
  type: "vetchium-problem-details/admin-permission-required",
  title: "Admin permission required",
  status: 403,
  detail: "The authenticated admin lacks the required permission",
};
