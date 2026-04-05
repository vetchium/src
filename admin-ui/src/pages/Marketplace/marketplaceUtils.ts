export function statusColor(status: string): string {
	switch (status) {
		case "active":
			return "green";
		case "pending_approval":
		case "pending_review":
		case "pending":
			return "gold";
		case "rejected":
			return "red";
		case "suspended":
			return "volcano";
		case "expired":
			return "orange";
		case "disabled":
			return "default";
		case "cancelled":
			return "gray";
		default:
			return "blue";
	}
}
