// Cross-module signal used when an authenticated request comes back 401 (e.g. the
// server was restarted and the in-memory/DB session is gone). Non-React modules
// (hooks doing fetches) dispatch it; AuthProvider listens and tears down the
// stale client session so the user is returned to the login screen instead of
// being stuck in a half-authenticated state.
export const ORG_UNAUTHORIZED_EVENT = "vetchium:org-unauthorized";

export function dispatchOrgUnauthorized(): void {
	window.dispatchEvent(new Event(ORG_UNAUTHORIZED_EVENT));
}
