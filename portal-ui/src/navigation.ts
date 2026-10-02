// The `returnTo` query parameter is attacker-controllable: it survives in a
// link a signed-out user can be sent. Only a path on this origin is a safe
// destination, so a value that is absolute, protocol-relative ("//host"), or
// otherwise not rooted at "/" falls back to the home route. Browsers read a
// backslash as a slash, so "/\host" is protocol-relative too.
export function safeReturnTo(value: string | null): string {
  if (
    value === null ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return "/";
  }
  return value;
}
