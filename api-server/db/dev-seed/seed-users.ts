#!/usr/bin/env bun
// Dev seed script: creates Harry Potter characters as hub users and org (house) users.
// Runs as a docker-compose service after all API servers and regional workers are healthy.
// Hub users and org accounts are created in parallel for speed.

const API = "http://api-lb:80";
const MAILPIT = "http://mailpit:8025/api/v1";
const PASSWORD = "Password123$";
const LANG = "en-US";

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function post(
	path: string,
	body: unknown,
	token?: string
): Promise<Response> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (token) headers["Authorization"] = `Bearer ${token}`;
	return fetch(`${API}${path}`, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
}

// ============================================================================
// Mailpit helpers (mirrors playwright/lib/mailpit.ts pattern)
// ============================================================================

async function mailpitSearch(toEmail: string): Promise<{ ID: string }[]> {
	const q = encodeURIComponent(`to:${toEmail}`);
	const res = await fetch(`${MAILPIT}/search?query=${q}`);
	if (!res.ok) return [];
	const data = (await res.json()) as { messages?: { ID: string }[] };
	return data.messages ?? [];
}

async function mailpitGetText(id: string): Promise<string> {
	const res = await fetch(`${MAILPIT}/message/${id}`);
	if (!res.ok) throw new Error(`Failed to fetch mailpit message ${id}`);
	const data = (await res.json()) as { Text: string };
	return data.Text;
}

async function clearEmails(email: string): Promise<void> {
	const msgs = await mailpitSearch(email);
	if (msgs.length) {
		await fetch(`${MAILPIT}/messages`, {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ IDs: msgs.map((m) => m.ID) }),
		});
	}
}

// Sleep first, then poll mailpit until an email matching the predicate arrives.
async function waitForEmailText(
	toEmail: string,
	predicate: (text: string) => boolean = () => true,
	initialSleepMs = 2000,
	retries = 15,
	retryDelayMs = 2000
): Promise<string> {
	await sleep(initialSleepMs);
	for (let i = 0; i < retries; i++) {
		const msgs = await mailpitSearch(toEmail);
		for (const msg of msgs) {
			const text = await mailpitGetText(msg.ID);
			if (predicate(text)) return text;
		}
		if (i < retries - 1) await sleep(retryDelayMs);
	}
	throw new Error(`No matching email for ${toEmail} after ${retries} retries`);
}

function extractHubSignupToken(text: string): string {
	const m = text.match(/token=([a-f0-9]{64})/);
	if (!m) throw new Error(`No hub signup token in email: ${text.slice(0, 300)}`);
	return m[1];
}

function extractOrgSignupToken(text: string): string {
	const m = text.match(/\b([a-f0-9]{64})\b/);
	if (!m) throw new Error(`No org signup token in email: ${text.slice(0, 300)}`);
	return m[1];
}

function extractTfaCode(text: string): string {
	const m = text.match(/\b(\d{6})\b/);
	if (!m) throw new Error(`No 6-digit TFA code in email: ${text.slice(0, 300)}`);
	return m[1];
}

// ============================================================================
// Admin login (sequential — needed before any other operation)
// ============================================================================

async function adminLogin(): Promise<string> {
	console.log("Logging in as admin1@vetchium.com ...");
	await clearEmails("admin1@vetchium.com");

	const loginRes = await post("/admin/login", {
		email: "admin1@vetchium.com",
		password: PASSWORD,
	});
	if (loginRes.status !== 200) {
		throw new Error(
			`Admin login failed: ${loginRes.status} — ${await loginRes.text()}`
		);
	}
	const { tfa_token } = (await loginRes.json()) as { tfa_token: string };

	const emailText = await waitForEmailText("admin1@vetchium.com");
	const tfaCode = extractTfaCode(emailText);

	const tfaRes = await post("/admin/tfa", { tfa_token, tfa_code: tfaCode });
	if (tfaRes.status !== 200) {
		throw new Error(
			`Admin TFA failed: ${tfaRes.status} — ${await tfaRes.text()}`
		);
	}
	const { session_token } = (await tfaRes.json()) as { session_token: string };
	console.log("  Admin login OK");
	return session_token;
}

// ============================================================================
// Approved domains
// ============================================================================

async function createApprovedDomain(
	domain: string,
	adminToken: string
): Promise<void> {
	console.log(`  Whitelisting ${domain} ...`);
	const res = await post(
		"/admin/create-approved-domain",
		{ domain_name: domain, reason: "Harry Potter dev seed" },
		adminToken
	);
	if (res.status === 409) {
		console.log(`    already exists, skipping`);
		return;
	}
	if (res.status !== 200 && res.status !== 201) {
		throw new Error(
			`create-approved-domain failed for ${domain}: ${res.status} — ${await res.text()}`
		);
	}
	console.log(`    done`);
}

// ============================================================================
// Hub users (run in parallel)
// ============================================================================

interface HubUser {
	email: string;
	displayName: string;
	homeRegion: "ind1" | "usa1" | "deu1";
	countryCode: string;
}

async function createHubUser(user: HubUser): Promise<void> {
	await clearEmails(user.email);

	const signupRes = await post("/hub/request-signup", {
		email_address: user.email,
	});
	if (signupRes.status === 409) {
		console.log(`  hub: ${user.email} — already registered, skipping`);
		return;
	}
	if (signupRes.status !== 200) {
		throw new Error(
			`request-signup failed for ${user.email}: ${signupRes.status} — ${await signupRes.text()}`
		);
	}

	// Sleep then query mailpit for the signup verification email.
	const emailText = await waitForEmailText(user.email);
	const signupToken = extractHubSignupToken(emailText);

	const completeRes = await post("/hub/complete-signup", {
		signup_token: signupToken,
		password: PASSWORD,
		preferred_display_name: user.displayName,
		home_region: user.homeRegion,
		preferred_language: LANG,
		resident_country_code: user.countryCode,
	});
	if (completeRes.status !== 201) {
		throw new Error(
			`complete-signup failed for ${user.email}: ${completeRes.status} — ${await completeRes.text()}`
		);
	}
	console.log(`  hub: ${user.email} — created`);
}

// ============================================================================
// Org users / house companies (run in parallel)
// ============================================================================

interface OrgAdmin {
	email: string;
	homeRegion: "ind1" | "usa1" | "deu1";
}

async function createOrg(admin: OrgAdmin): Promise<void> {
	await clearEmails(admin.email);

	const initRes = await post("/org/init-signup", {
		email: admin.email,
		home_region: admin.homeRegion,
	});
	if (initRes.status === 409) {
		console.log(`  org: ${admin.email} — already exists, skipping`);
		return;
	}
	if (initRes.status !== 200) {
		throw new Error(
			`org init-signup failed for ${admin.email}: ${initRes.status} — ${await initRes.text()}`
		);
	}

	// Org signup sends two emails (DNS instructions + private token).
	// Sleep a bit longer, then find the private token email.
	const emailText = await waitForEmailText(
		admin.email,
		(text) => text.includes("DO NOT FORWARD") || text.includes("Private Link"),
		3000
	);
	const signupToken = extractOrgSignupToken(emailText);

	const completeRes = await post("/org/complete-signup", {
		signup_token: signupToken,
		password: PASSWORD,
		preferred_language: LANG,
		has_added_dns_record: true,
		agrees_to_eula: true,
	});
	if (completeRes.status !== 201) {
		throw new Error(
			`org complete-signup failed for ${admin.email}: ${completeRes.status} — ${await completeRes.text()}`
		);
	}
	console.log(`  org: ${admin.email} — created`);
}

// ============================================================================
// Seed data
// ============================================================================

const HUB_USERS: HubUser[] = [
	// Gryffindor
	{ email: "harry@hub.example", displayName: "Harry Potter", homeRegion: "ind1", countryCode: "GB" },
	{ email: "hermione@hub.example", displayName: "Hermione Granger", homeRegion: "usa1", countryCode: "GB" },
	{ email: "ron@hub.example", displayName: "Ron Weasley", homeRegion: "deu1", countryCode: "GB" },
	{ email: "neville@hub.example", displayName: "Neville Longbottom", homeRegion: "ind1", countryCode: "GB" },
	// Slytherin
	{ email: "draco@hub.example", displayName: "Draco Malfoy", homeRegion: "usa1", countryCode: "GB" },
	{ email: "pansy@hub.example", displayName: "Pansy Parkinson", homeRegion: "deu1", countryCode: "GB" },
	// Ravenclaw
	{ email: "luna@hub.example", displayName: "Luna Lovegood", homeRegion: "deu1", countryCode: "GB" },
	{ email: "cho@hub.example", displayName: "Cho Chang", homeRegion: "ind1", countryCode: "GB" },
	// Hufflepuff
	{ email: "cedric@hub.example", displayName: "Cedric Diggory", homeRegion: "usa1", countryCode: "GB" },
	{ email: "hannah@hub.example", displayName: "Hannah Abbott", homeRegion: "ind1", countryCode: "GB" },
];

// One superadmin per house org, using admin@<housename>.example
const ORG_ADMINS: OrgAdmin[] = [
	{ email: "admin@gryffindor.example", homeRegion: "ind1" },
	{ email: "admin@slytherin.example", homeRegion: "usa1" },
	{ email: "admin@ravenclaw.example", homeRegion: "deu1" },
	{ email: "admin@hufflepuff.example", homeRegion: "ind1" },
];

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
	console.log("=== Vetchium Harry Potter Dev Seed ===\n");

	const adminToken = await adminLogin();

	// Whitelist hub.example so hub users can sign up with @hub.example addresses.
	console.log("\nWhitelisting approved email domain...");
	await createApprovedDomain("hub.example", adminToken);

	// Create all hub users in parallel — each has a unique email so mailpit queries
	// are isolated and there are no race conditions.
	console.log("\nCreating hub users in parallel...");
	await Promise.all(HUB_USERS.map(createHubUser));

	// Create all house org accounts in parallel.
	console.log("\nCreating house orgs in parallel...");
	await Promise.all(ORG_ADMINS.map(createOrg));

	console.log("\n=== Seed complete! ===");
	console.log(
		"\nHub users — log in at http://localhost:3000 (password: Password123$):"
	);
	for (const u of HUB_USERS) {
		console.log(`  ${u.email}  (home: ${u.homeRegion})`);
	}
	console.log(
		"\nOrg superadmins — log in at http://localhost:3002 (password: Password123$):"
	);
	for (const u of ORG_ADMINS) {
		const domain = u.email.split("@")[1];
		console.log(`  ${u.email}  →  ${domain}  (home: ${u.homeRegion})`);
	}
}

main().catch((err) => {
	console.error("\nSeed failed:", err);
	process.exit(1);
});
