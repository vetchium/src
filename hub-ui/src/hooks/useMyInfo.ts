import { useState, useEffect } from "react";
import type { HubMyInfoResponse } from "vetchium-specs/hub/hub-users";
import { getApiBaseUrl } from "../config";

interface MyInfoState {
	data: HubMyInfoResponse | null;
	loading: boolean;
	error: string | null;
}

let cachedMyInfo: HubMyInfoResponse | null = null;

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
				const response = await fetch(`${apiBaseUrl}/hub/myinfo`, {
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
				});

				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				const data: HubMyInfoResponse = await response.json();
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
