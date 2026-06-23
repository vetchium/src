import { useEffect, useState } from "react";
import type { PendingReferralsCountResponse } from "vetchium-specs/hub/referrals";
import { getApiBaseUrl } from "../config";

// Fetches the number of agency referrals awaiting the candidate's action so the
// dashboard tile can surface an actionable badge. Fetched fresh on mount (not
// cached) so the badge reflects referrals the user has just applied to/declined.
export function usePendingReferralsCount(sessionToken: string | null) {
	const [count, setCount] = useState(0);

	useEffect(() => {
		let cancelled = false;
		const fetchCount = async () => {
			if (!sessionToken) {
				if (!cancelled) setCount(0);
				return;
			}
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const response = await fetch(
					`${apiBaseUrl}/hub/pending-referrals-count`,
					{
						method: "GET",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
					}
				);
				if (!response.ok) return;
				const data: PendingReferralsCountResponse = await response.json();
				if (!cancelled) {
					setCount(data.count);
				}
			} catch {
				// Badge is best-effort; silently ignore failures.
			}
		};

		fetchCount();
		return () => {
			cancelled = true;
		};
	}, [sessionToken]);

	return count;
}
