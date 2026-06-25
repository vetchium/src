import { useState, useEffect } from "react";
import type { AdminMyInfoResponse } from "vetchium-specs/admin/admin-users";
import { getApiBaseUrl } from "../config";
import { dispatchAdminUnauthorized } from "../lib/sessionEvents";

interface MyInfoState {
	data: AdminMyInfoResponse | null;
	loading: boolean;
	error: string | null;
}

let cachedMyInfo: AdminMyInfoResponse | null = null;

export function useMyInfo(sessionToken: string | null) {
	const [state, setState] = useState<MyInfoState>({
		data: cachedMyInfo,
		loading: !cachedMyInfo,
		error: null,
	});

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
				const response = await fetch(`${apiBaseUrl}/admin/myinfo`, {
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
				});

				if (response.status === 401) {
					// Stale session (e.g. server restarted): tear it down globally.
					clearMyInfoCache();
					dispatchAdminUnauthorized();
					setState({ data: null, loading: false, error: null });
					return;
				}

				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				const data: AdminMyInfoResponse = await response.json();
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
	}, [sessionToken]);

	return state;
}

export function clearMyInfoCache() {
	cachedMyInfo = null;
}

// Seed the cache from a myinfo response already fetched elsewhere (e.g. the
// startup session validation) so consumers don't refetch the same data.
export function primeMyInfoCache(data: AdminMyInfoResponse) {
	cachedMyInfo = data;
}
