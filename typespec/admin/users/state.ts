/** The externally visible state of an admin user. */
export type AdminUserState = "active" | "disabled";

export const Active: AdminUserState = "active";
export const Disabled: AdminUserState = "disabled";

export function isAdminUserState(value: string): value is AdminUserState {
  return value === Active || value === Disabled;
}
