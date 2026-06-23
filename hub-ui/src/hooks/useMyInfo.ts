import { useState, useEffect } from "react";
import type { HubMyInfoResponse } from "vetchium-specs/hub/hub-users";
import { getApiBaseUrl } from "../config";
import { dispatchHubUnauthorized } from "../lib/sessionEvents";

interface MyInfoState {
	data: HubMyInfoResponse | null;
	loading: boolean;
	error: string | null;
}

// Cache is keyed by the session token so a different logged-in user (after
// logout → login in the same tab) never sees the previous user's cached info.
let cachedMyInfo: HubMyInfoResponse | null = null;
let cachedToken: string | null = null;

export function useMyInfo(sessionToken: string | null) {
	const [state, setState] = useState<MyInfoState>(() => {
		const hasFreshCache = cachedMyInfo !== null && cachedToken === sessionToken;
		return {
			data: hasFreshCache ? cachedMyInfo : null,
			loading: !hasFreshCache && sessionToken !== null,
			error: null,
		};
	});

	useEffect(() => {
		if (!sessionToken) {
			setState({ data: null, loading: false, error: null });
			clearMyInfoCache();
			return;
		}

		// Serve from cache only when it belongs to the current session token.
		if (cachedMyInfo && cachedToken === sessionToken) {
			setState({ data: cachedMyInfo, loading: false, error: null });
			return;
		}

		// A different (or first) token: drop any stale cache before refetching.
		clearMyInfoCache();
		setState({ data: null, loading: true, error: null });

		const fetchMyInfo = async () => {
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const response = await fetch(`${apiBaseUrl}/hub/myinfo`, {
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
				});

				if (response.status === 401) {
					// Stale session (e.g. server restarted): tear it down globally.
					clearMyInfoCache();
					dispatchHubUnauthorized();
					setState({ data: null, loading: false, error: null });
					return;
				}

				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				const data: HubMyInfoResponse = await response.json();
				cachedMyInfo = data;
				cachedToken = sessionToken;
				setState({ data, loading: false, error: null });
			} catch (err) {
				setState({
					data: null,
					loading: false,
					error:
						err instanceof Error ? err.message : "Failed to fetch user info",
				});
			}
		};

		fetchMyInfo();
	}, [sessionToken]);

	return state;
}

export function clearMyInfoCache() {
	cachedMyInfo = null;
	cachedToken = null;
}

// Seed the cache from a myinfo response already fetched elsewhere (e.g. the
// startup session validation) so consumers don't refetch the same data.
export function primeMyInfoCache(
	sessionToken: string,
	data: HubMyInfoResponse
) {
	cachedMyInfo = data;
	cachedToken = sessionToken;
}
