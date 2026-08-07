/** Types describing users in the admin portal. */
namespace Vetchium.Admin.User;

/** The externally visible state of a user. */
union State {
  active: "active",
  disabled: "disabled",
}
