// Cross-module signal used when an authenticated request comes back 401 (e.g. the
// server was restarted and the in-memory/DB session is gone). Non-React modules
// (hooks doing fetches) dispatch it; AuthProvider listens and tears down the
// stale client session so the user is returned to the login screen instead of
// being stuck in a half-authenticated state.
export const HUB_UNAUTHORIZED_EVENT = "vetchium:hub-unauthorized";

export function dispatchHubUnauthorized(): void {
	window.dispatchEvent(new Event(HUB_UNAUTHORIZED_EVENT));
}
