import { deleteAllEmails } from "./lib/mailpit";

async function main() {
	console.log("Cleaning all emails from Mailpit...");
	try {
		await deleteAllEmails();
		console.log("Successfully cleaned all emails.");
	} catch (error) {
		console.error("Failed to clean emails:", error);
		process.exit(1);
	}
}

main();
