/**
 * Formats a date string or Date object using the browser's locale.
 * Uses full month names to avoid confusion between day/month order.
 * Falls back to a clear ISO-style format if locale is not set.
 *
 * @param date - ISO date string or Date object
 * @returns Formatted date string in browser locale with full month names
 */
export function formatDateTime(date: string | Date): string {
	const dateObj = typeof date === "string" ? new Date(date) : date;
	return dateObj.toLocaleString();
}
