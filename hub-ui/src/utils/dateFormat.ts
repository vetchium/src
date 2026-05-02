export function formatDateTime(date: string | Date, locale: string): string {
	const dateObj = typeof date === "string" ? new Date(date) : date;
	return dateObj.toLocaleString(locale, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function formatDate(date: string | Date, locale: string): string {
	const dateObj = typeof date === "string" ? new Date(date) : date;
	return dateObj.toLocaleDateString(locale, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}
