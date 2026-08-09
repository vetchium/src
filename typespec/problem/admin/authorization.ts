import type { Details } from "../details.ts";

export const AdminPermissionRequiredError: Readonly<Details> = {
  type: "vetchium-problem-details/admin-permission-required",
  title: "Admin permission required",
  status: 403,
  detail: "The authenticated admin lacks the required permission",
};

export const SuperadminRequiredError: Readonly<Details> = {
  type: "vetchium-problem-details/superadmin-required",
  title: "Superadmin required",
  status: 403,
  detail: "The operation requires an authenticated superadmin",
};

export const PermissionDependencyConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/permission-dependency-conflict",
  title: "Permission dependency conflict",
  status: 409,
  detail:
    "The permission cannot be revoked while another assigned permission depends on it",
};

export const PermissionNotApplicableError: Readonly<Details> = {
  type: "vetchium-problem-details/permission-not-applicable",
  title: "Permission not applicable",
  status: 409,
  detail: "Direct permissions are not applicable to a superadmin",
};

export const CannotDemoteCurrentSuperadminError: Readonly<Details> = {
  type: "vetchium-problem-details/cannot-demote-current-superadmin",
  title: "Cannot demote current superadmin",
  status: 409,
  detail: "A superadmin cannot demote their own account",
};
