namespace Vetchium.Admin;

/** The externally visible state of an admin user. */
union AdminUserState {
  active: "active",
  disabled: "disabled",
}
