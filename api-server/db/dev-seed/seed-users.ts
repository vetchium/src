#!/usr/bin/env bun
// Dev seed script: creates Harry Potter characters as hub users and org (house) users.
// Runs as a docker-compose service after all API servers and regional workers are healthy.

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
// Mailpit helpers
// ============================================================================

async function clearEmails(email: string): Promise<void> {
	const q = encodeURIComponent(`to:${email}`);
	const res = await fetch(`${MAILPIT}/search?query=${q}`);
	if (!res.ok) return;
	const data = (await res.json()) as { messages?: { ID: string }[] };
	if (data.messages?.length) {
		await fetch(`${MAILPIT}/messages`, {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ IDs: data.messages.map((m) => m.ID) }),
		});
	}
}

async function waitForEmail(
	toEmail: string,
	predicate: (text: string) => boolean = () => true,
	retries = 20,
	delayMs = 2000
): Promise<string> {
	for (let i = 0; i < retries; i++) {
		const q = encodeURIComponent(`to:${toEmail}`);
		const res = await fetch(`${MAILPIT}/search?query=${q}`);
		if (res.ok) {
			const data = (await res.json()) as {
				messages?: { ID: string }[];
			};
			for (const msg of data.messages ?? []) {
				const full = await fetch(`${MAILPIT}/message/${msg.ID}`);
				if (full.ok) {
					const content = (await full.json()) as { Text: string };
					if (predicate(content.Text)) return content.Text;
				}
			}
		}
		await sleep(delayMs);
	}
	throw new Error(`No matching email for ${toEmail} after ${retries} retries`);
}

function extractHubSignupToken(text: string): string {
	const m = text.match(/token=([a-f0-9]{64})/);
	if (!m)
		throw new Error(
			`No hub signup token in email: ${text.slice(0, 300)}`
		);
	return m[1];
}

function extractOrgSignupToken(text: string): string {
	const m = text.match(/\b([a-f0-9]{64})\b/);
	if (!m)
		throw new Error(
			`No 64-char org signup token in email: ${text.slice(0, 300)}`
		);
	return m[1];
}

function extractTfaCode(text: string): string {
	const m = text.match(/\b(\d{6})\b/);
	if (!m)
		throw new Error(`No 6-digit TFA code in email: ${text.slice(0, 300)}`);
	return m[1];
}

// ============================================================================
// Admin login (with TFA)
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

	const emailText = await waitForEmail("admin1@vetchium.com");
	const tfaCode = extractTfaCode(emailText);

	const tfaRes = await post("/admin/tfa", {
		tfa_token,
		tfa_code: tfaCode,
	});
	if (tfaRes.status !== 200) {
		throw new Error(
			`Admin TFA failed: ${tfaRes.status} — ${await tfaRes.text()}`
		);
	}
	const { session_token } = (await tfaRes.json()) as {
		session_token: string;
	};
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
	console.log(`  ${domain} ...`);
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
	console.log(`    created`);
}

// ============================================================================
// Hub users
// ============================================================================

interface HubUser {
	email: string;
	displayName: string;
	homeRegion: "ind1" | "usa1" | "deu1";
	countryCode: string;
}

async function createHubUser(user: HubUser): Promise<void> {
	console.log(`  ${user.email} ...`);
	await clearEmails(user.email);

	const signupRes = await post("/hub/request-signup", {
		email_address: user.email,
	});
	if (signupRes.status === 409) {
		console.log(`    already registered, skipping`);
		return;
	}
	if (signupRes.status !== 200) {
		throw new Error(
			`request-signup failed for ${user.email}: ${signupRes.status} — ${await signupRes.text()}`
		);
	}

	const emailText = await waitForEmail(user.email);
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
	console.log(`    created`);
}

// ============================================================================
// Org users (house companies, one superadmin each)
// ============================================================================

interface OrgAdmin {
	email: string;
	homeRegion: "ind1" | "usa1" | "deu1";
}

async function createOrg(admin: OrgAdmin): Promise<void> {
	console.log(`  ${admin.email} ...`);
	await clearEmails(admin.email);

	const initRes = await post("/org/init-signup", {
		email: admin.email,
		home_region: admin.homeRegion,
	});
	if (initRes.status === 409) {
		console.log(`    org already exists, skipping`);
		return;
	}
	if (initRes.status !== 200) {
		throw new Error(
			`org init-signup failed for ${admin.email}: ${initRes.status} — ${await initRes.text()}`
		);
	}

	// Two emails are sent: DNS instructions and the private token email.
	// The token email contains "DO NOT FORWARD" in the body.
	const emailText = await waitForEmail(
		admin.email,
		(text) => text.includes("DO NOT FORWARD") || text.includes("Private Link")
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
	console.log(`    created`);
}

// ============================================================================
// Seed data
// ============================================================================

const HUB_USERS: HubUser[] = [
	// Gryffindor characters — house-domain emails are their work emails
	{
		email: "harry.potter@hub.example",
		displayName: "Harry Potter",
		homeRegion: "ind1",
		countryCode: "GB",
	},
	{
		email: "hermione.granger@hub.example",
		displayName: "Hermione Granger",
		homeRegion: "usa1",
		countryCode: "GB",
	},
	{
		email: "ron.weasley@hub.example",
		displayName: "Ron Weasley",
		homeRegion: "deu1",
		countryCode: "GB",
	},
	{
		email: "neville.longbottom@hub.example",
		displayName: "Neville Longbottom",
		homeRegion: "ind1",
		countryCode: "GB",
	},
	// Slytherin characters
	{
		email: "draco.malfoy@hub.example",
		displayName: "Draco Malfoy",
		homeRegion: "usa1",
		countryCode: "GB",
	},
	{
		email: "pansy.parkinson@hub.example",
		displayName: "Pansy Parkinson",
		homeRegion: "deu1",
		countryCode: "GB",
	},
	// Ravenclaw characters
	{
		email: "luna.lovegood@hub.example",
		displayName: "Luna Lovegood",
		homeRegion: "deu1",
		countryCode: "GB",
	},
	{
		email: "cho.chang@hub.example",
		displayName: "Cho Chang",
		homeRegion: "ind1",
		countryCode: "GB",
	},
	// Hufflepuff characters
	{
		email: "cedric.diggory@hub.example",
		displayName: "Cedric Diggory",
		homeRegion: "usa1",
		countryCode: "GB",
	},
	{
		email: "hannah.abbott@hub.example",
		displayName: "Hannah Abbott",
		homeRegion: "ind1",
		countryCode: "GB",
	},
];

// Each house has one org superadmin (the same email can also be a hub user —
// hub and org are separate portals with independent accounts).
const ORG_ADMINS: OrgAdmin[] = [
	{ email: "harry.potter@gryffindor.example", homeRegion: "ind1" },
	{ email: "draco.malfoy@slytherin.example", homeRegion: "usa1" },
	{ email: "luna.lovegood@ravenclaw.example", homeRegion: "deu1" },
	{ email: "cedric.diggory@hufflepuff.example", homeRegion: "ind1" },
];

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
	console.log("=== Vetchium Harry Potter Dev Seed ===\n");

	// Retry admin login — API server may need a moment to finish starting up.
	let adminToken = "";
	for (let attempt = 1; attempt <= 10; attempt++) {
		try {
			adminToken = await adminLogin();
			break;
		} catch (err) {
			if (attempt === 10) throw err;
			console.log(
				`  login attempt ${attempt} failed, retrying in 5s...`
			);
			await sleep(5000);
		}
	}

	console.log("\nCreating approved email domain for hub signups...");
	await createApprovedDomain("hub.example", adminToken);

	console.log("\nCreating hub users (Hub portal)...");
	for (const user of HUB_USERS) {
		await createHubUser(user);
	}

	console.log("\nCreating house orgs (Org portal)...");
	for (const admin of ORG_ADMINS) {
		await createOrg(admin);
	}

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
