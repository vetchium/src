import { useState, useEffect, useCallback } from "react";
import type { OrgMyInfoResponse } from "vetchium-specs/org/org-users";
import { getApiBaseUrl } from "../config";
import { dispatchOrgUnauthorized } from "../lib/sessionEvents";

interface MyInfoState {
	data: OrgMyInfoResponse | null;
	loading: boolean;
	error: string | null;
}

let cachedMyInfo: OrgMyInfoResponse | null = null;

export function useMyInfo(sessionToken: string | null) {
	const [state, setState] = useState<MyInfoState>({
		data: cachedMyInfo,
		loading: !cachedMyInfo,
		error: null,
	});
	const [fetchTrigger, setFetchTrigger] = useState(0);

	useEffect(() => {
		if (!sessionToken) {
			setState({ data: null, loading: false, error: null });
			cachedMyInfo = null;
			return;
		}

		if (cachedMyInfo) {
			setState({ data: cachedMyInfo, loading: false, error: null });
			return;
		}

		const fetchMyInfo = async () => {
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const response = await fetch(`${apiBaseUrl}/org/myinfo`, {
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
				});

				if (response.status === 401) {
					// Stale session (e.g. server restarted): tear it down globally.
					clearMyInfoCache();
					dispatchOrgUnauthorized();
					setState({ data: null, loading: false, error: null });
					return;
				}

				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				const data: OrgMyInfoResponse = await response.json();
				cachedMyInfo = data;
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
	}, [sessionToken, fetchTrigger]);

	// Clears the module-level cache and increments the trigger so the effect re-runs.
	const refetch = useCallback(() => {
		cachedMyInfo = null;
		setFetchTrigger((n) => n + 1);
	}, []);

	return { ...state, refetch };
}

export function clearMyInfoCache() {
	cachedMyInfo = null;
}

// Seed the cache from a myinfo response already fetched elsewhere (e.g. the
// startup session validation) so consumers don't refetch the same data.
export function primeMyInfoCache(data: OrgMyInfoResponse) {
	cachedMyInfo = data;
}
