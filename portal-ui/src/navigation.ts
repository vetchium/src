// The `returnTo` query parameter is attacker-controllable: it survives in a
// link a signed-out user can be sent. Only a path on this origin is a safe
// destination, so a value that is absolute, protocol-relative ("//host"), or
// otherwise not rooted at "/" falls back to the home route.
export function safeReturnTo(value: string | null): string {
  if (value === null || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}
