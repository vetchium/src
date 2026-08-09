import type { Details } from "../details.ts";

export const AdminUserNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/admin-user-not-found",
  title: "Admin user not found",
  status: 404,
  detail: "The requested admin user does not exist",
};

export const CannotDisableCurrentAdminError: Readonly<Details> = {
  type: "vetchium-problem-details/cannot-disable-current-admin",
  title: "Cannot disable current admin",
  status: 409,
  detail: "An admin cannot disable their own account",
};

export const LastActiveSuperadminError: Readonly<Details> = {
  type: "vetchium-problem-details/last-active-superadmin",
  title: "Last active superadmin",
  status: 409,
  detail: "The operation would leave no active superadmin",
};

export const AdminUserAlreadyExistsError: Readonly<Details> = {
  type: "vetchium-problem-details/admin-user-already-exists",
  title: "Admin user already exists",
  status: 409,
  detail: "An admin user already exists for the normalized email address",
};

export const AdminInvitationAlreadyPendingError: Readonly<Details> = {
  type: "vetchium-problem-details/admin-invitation-already-pending",
  title: "Admin invitation already pending",
  status: 409,
  detail:
    "A non-expired invitation already exists for the normalized email address",
};
