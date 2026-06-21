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
	if (!m)
		throw new Error(`No hub signup token in email: ${text.slice(0, 300)}`);
	return m[1];
}

function extractOrgSignupToken(text: string): string {
	const m = text.match(/\b([a-f0-9]{64})\b/);
	if (!m)
		throw new Error(`No org signup token in email: ${text.slice(0, 300)}`);
	return m[1];
}

// Org invitation tokens carry a region prefix (e.g. IND1-<64 hex>) in the
// /complete-setup?token=... link, unlike the bare signup token above.
function extractOrgInvitationToken(text: string): string {
	const m = text.match(/token=([A-Z0-9]+-[a-f0-9]{64})/);
	if (!m)
		throw new Error(`No org invitation token in email: ${text.slice(0, 300)}`);
	return m[1];
}

function extractTfaCode(text: string): string {
	const m = text.match(/\b(\d{6})\b/);
	if (!m)
		throw new Error(`No 6-digit TFA code in email: ${text.slice(0, 300)}`);
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

// Log in as an existing org user and return a session token.
// Mirrors adminLogin: login -> mailpit TFA code -> tfa.
async function orgLogin(email: string, domain: string): Promise<string> {
	await clearEmails(email);

	const loginRes = await post("/org/login", {
		email,
		domain,
		password: PASSWORD,
	});
	if (loginRes.status !== 200) {
		throw new Error(
			`org login failed for ${email}: ${loginRes.status} — ${await loginRes.text()}`
		);
	}
	const { tfa_token } = (await loginRes.json()) as { tfa_token: string };

	const emailText = await waitForEmailText(email);
	const tfaCode = extractTfaCode(emailText);

	const tfaRes = await post("/org/tfa", {
		tfa_token,
		tfa_code: tfaCode,
		remember_me: false,
	});
	if (tfaRes.status !== 200) {
		throw new Error(
			`org TFA failed for ${email}: ${tfaRes.status} — ${await tfaRes.text()}`
		);
	}
	const { session_token } = (await tfaRes.json()) as { session_token: string };
	return session_token;
}

interface OrgInvitee {
	email: string;
	fullName: string;
	roles: string[];
}

// Invite an org user and complete their setup so they end up active with a
// password. Idempotent: a 409 (already a member) is treated as success.
async function inviteOrgUser(
	adminToken: string,
	invitee: OrgInvitee
): Promise<void> {
	await clearEmails(invitee.email);

	const inviteRes = await post(
		"/org/invite-user",
		{ email_address: invitee.email, roles: invitee.roles },
		adminToken
	);
	if (inviteRes.status === 409) {
		console.log(`    invite: ${invitee.email} — already a member, skipping`);
		return;
	}
	if (inviteRes.status !== 201) {
		throw new Error(
			`invite-user failed for ${invitee.email}: ${inviteRes.status} — ${await inviteRes.text()}`
		);
	}

	const emailText = await waitForEmailText(invitee.email);
	const invitationToken = extractOrgInvitationToken(emailText);

	const setupRes = await post("/org/complete-setup", {
		invitation_token: invitationToken,
		password: PASSWORD,
		full_name: invitee.fullName,
		preferred_language: LANG,
	});
	if (setupRes.status !== 200) {
		throw new Error(
			`complete-setup failed for ${invitee.email}: ${setupRes.status} — ${await setupRes.text()}`
		);
	}
	console.log(
		`    invite: ${invitee.email} — created [${invitee.roles.join(", ")}]`
	);
}

interface OrgAddressSeed {
	title: string;
	address_line1: string;
	address_line2?: string;
	city: string;
	state?: string;
	postal_code?: string;
	country: string;
	map_urls?: string[];
}

// Create an org address. Idempotent: skips if an address with the same title
// already exists (addresses have no natural unique key).
async function createOrgAddress(
	adminToken: string,
	address: OrgAddressSeed
): Promise<void> {
	const listRes = await post("/org/list-addresses", {}, adminToken);
	if (listRes.status === 200) {
		const { addresses } = (await listRes.json()) as {
			addresses: { title: string }[];
		};
		if (addresses.some((a) => a.title === address.title)) {
			console.log(`    address: "${address.title}" — already exists, skipping`);
			return;
		}
	}

	const res = await post("/org/create-address", address, adminToken);
	if (res.status !== 201) {
		throw new Error(
			`create-address failed for "${address.title}": ${res.status} — ${await res.text()}`
		);
	}
	console.log(`    address: "${address.title}" — created`);
}

// Seed the Gryffindor org with an extra admin, an office address and members.
async function seedGryffindor(): Promise<void> {
	const domain = "gryffindor.example";
	console.log(`\nSeeding ${domain} (admin, address, members)...`);

	const adminToken = await orgLogin("admin@gryffindor.example", domain);

	await createOrgAddress(adminToken, GRYFFINDOR_ADDRESS);

	// Sequential: the free tier caps org_users at 5 (1 existing + 4 here), so
	// keep ordering deterministic and avoid any quota race between parallel invites.
	for (const invitee of GRYFFINDOR_INVITEES) {
		await inviteOrgUser(adminToken, invitee);
	}
}

// Return the address_id for the named address, or throw if not found.
async function getAddressId(token: string, title: string): Promise<string> {
	const res = await post("/org/list-addresses", {}, token);
	if (res.status !== 200)
		throw new Error(`list-addresses failed: ${res.status}`);
	const { addresses } = (await res.json()) as {
		addresses: { address_id: string; title: string }[];
	};
	const found = addresses.find((a) => a.title === title);
	if (!found) throw new Error(`Address "${title}" not found`);
	return found.address_id;
}

interface OrgOpeningSeed {
	title: string;
	description: string;
	employment_type: string;
	work_location_type: string;
	number_of_positions: number;
	hiring_manager_email_address: string;
	recruiter_email_address: string;
	min_yoe?: number;
	max_yoe?: number;
	min_education_level?: string;
	salary?: { min_amount: number; max_amount: number; currency: string };
	internal_notes?: string;
}

// Create an opening and immediately submit it so it lands in "published"
// (superadmin submit bypasses review). Idempotent: skips if a matching title
// already exists in any status.
async function createAndSubmitOpening(
	token: string,
	opening: OrgOpeningSeed,
	addressId: string
): Promise<void> {
	// Check for an existing opening with the same title.
	const listRes = await post(
		"/org/list-openings",
		{ filter_title_prefix: opening.title, limit: 10 },
		token
	);
	if (listRes.status === 200) {
		const { openings } = (await listRes.json()) as {
			openings: { title: string }[];
		};
		if (openings.some((o) => o.title === opening.title)) {
			console.log(`    opening: "${opening.title}" — already exists, skipping`);
			return;
		}
	}

	const createRes = await post(
		"/org/create-opening",
		{
			...opening,
			is_internal: false,
			address_ids: [addressId],
		},
		token
	);
	if (createRes.status !== 201) {
		throw new Error(
			`create-opening failed for "${opening.title}": ${createRes.status} — ${await createRes.text()}`
		);
	}
	const { opening_number } = (await createRes.json()) as {
		opening_id: string;
		opening_number: number;
	};

	const submitRes = await post(
		"/org/submit-opening",
		{ opening_number },
		token
	);
	if (submitRes.status !== 200) {
		throw new Error(
			`submit-opening failed for "${opening.title}" (#${opening_number}): ${submitRes.status} — ${await submitRes.text()}`
		);
	}
	console.log(`    opening: "${opening.title}" — created and published`);
}

async function seedGryffindorOpenings(): Promise<void> {
	const domain = "gryffindor.example";
	console.log(`\nSeeding openings for ${domain}...`);

	// Superadmin token — submit goes directly to published (no review step).
	const adminToken = await orgLogin("admin@gryffindor.example", domain);
	const addressId = await getAddressId(adminToken, GRYFFINDOR_ADDRESS.title);

	for (const opening of GRYFFINDOR_OPENINGS) {
		await createAndSubmitOpening(adminToken, opening, addressId);
	}
}

// ============================================================================
// Agency (staffing marketplace provider)
// ============================================================================

// Self-upgrade the calling org to the silver plan so it can publish marketplace
// listings (the free tier caps marketplace_listings at 0). Idempotent: a 422 means
// the org is already on silver-or-higher, which is fine.
async function upgradeToSilver(token: string): Promise<void> {
	const res = await post("/org/upgrade-plan", { plan_id: "silver" }, token);
	if (res.status === 422) {
		console.log("    plan: already on silver or higher, skipping");
		return;
	}
	if (res.status !== 200) {
		throw new Error(`upgrade-plan failed: ${res.status} — ${await res.text()}`);
	}
	console.log("    plan: upgraded to silver");
}

// Create a marketplace listing and publish it. As a superadmin, publish lands the
// listing directly in "active" (no review step). Returns the listing_number.
// Idempotent: if a listing with the same headline already exists it is reused (and
// published if it is still a draft).
async function createAndPublishListing(
	token: string,
	listing: AgencyListingSeed
): Promise<number> {
	const listRes = await post("/org/marketplace/list-listings", {}, token);
	if (listRes.status === 200) {
		const { listings } = (await listRes.json()) as {
			listings: {
				headline: string;
				listing_number: number;
				status: string;
			}[];
		};
		const existing = listings.find((l) => l.headline === listing.headline);
		if (existing) {
			if (existing.status === "draft") {
				await post(
					"/org/marketplace/publish-listing",
					{ listing_number: existing.listing_number },
					token
				);
			}
			console.log(
				`    listing: "${listing.headline}" — already exists (#${existing.listing_number}), skipping`
			);
			return existing.listing_number;
		}
	}

	const createRes = await post(
		"/org/marketplace/create-listing",
		{
			headline: listing.headline,
			description: listing.description,
			capabilities: listing.capabilities,
		},
		token
	);
	if (createRes.status !== 201) {
		throw new Error(
			`create-listing failed: ${createRes.status} — ${await createRes.text()}`
		);
	}
	const { listing_number } = (await createRes.json()) as {
		listing_number: number;
	};

	const publishRes = await post(
		"/org/marketplace/publish-listing",
		{ listing_number },
		token
	);
	if (publishRes.status !== 200) {
		throw new Error(
			`publish-listing failed (#${listing_number}): ${publishRes.status} — ${await publishRes.text()}`
		);
	}
	console.log(
		`    listing: "${listing.headline}" — created and published (#${listing_number})`
	);
	return listing_number;
}

// Seed the staffing agency: create the org, upgrade it so it can publish, then list
// its staffing + BGV capabilities on the marketplace. Returns the listing_number so
// consumer orgs can subscribe to it.
async function seedAgency(): Promise<number> {
	console.log(`\nSeeding agency ${AGENCY.domain} (org, plan, listing)...`);
	await createOrg({ email: AGENCY.email, homeRegion: AGENCY.homeRegion });

	const token = await orgLogin(AGENCY.email, AGENCY.domain);
	await upgradeToSilver(token);

	// Invite the agency's recruiters and account managers. Sequential to keep ordering
	// deterministic and avoid any quota race between parallel invites (silver caps
	// org_users at 25, so the whole roster fits with room to spare).
	for (const invitee of AGENCY_INVITEES) {
		await inviteOrgUser(token, invitee);
	}

	return createAndPublishListing(token, AGENCY.listing);
}

// Subscribe a consumer org (Gryffindor) to the agency's staffing listing so the
// agency-referrals flow is exercisable out of the box: a consumer org can only assign
// an agency to an opening if it holds an active subscription to a 'staffing' listing.
// create-subscription upserts, so this is idempotent.
async function subscribeToAgency(listingNumber: number): Promise<void> {
	const domain = "gryffindor.example";
	console.log(
		`\nSubscribing ${domain} to ${AGENCY.domain}'s staffing listing...`
	);
	const token = await orgLogin("admin@gryffindor.example", domain);
	const res = await post(
		"/org/marketplace/create-subscription",
		{
			provider_org_domain: AGENCY.domain,
			provider_listing_number: listingNumber,
			request_note: "Engaging Floo Network Staffing for wizarding hires.",
		},
		token
	);
	if (res.status !== 201) {
		throw new Error(
			`create-subscription failed: ${res.status} — ${await res.text()}`
		);
	}
	console.log("    subscription: active");
}

// ============================================================================
// Seed data
// ============================================================================

const HUB_USERS: HubUser[] = [
	// Gryffindor
	{
		email: "harry@hub.example",
		displayName: "Harry Potter",
		homeRegion: "ind1",
		countryCode: "GB",
	},
	{
		email: "hermione@hub.example",
		displayName: "Hermione Granger",
		homeRegion: "usa1",
		countryCode: "GB",
	},
	{
		email: "ron@hub.example",
		displayName: "Ron Weasley",
		homeRegion: "deu1",
		countryCode: "GB",
	},
	{
		email: "neville@hub.example",
		displayName: "Neville Longbottom",
		homeRegion: "ind1",
		countryCode: "GB",
	},
	// Slytherin
	{
		email: "draco@hub.example",
		displayName: "Draco Malfoy",
		homeRegion: "usa1",
		countryCode: "GB",
	},
	{
		email: "pansy@hub.example",
		displayName: "Pansy Parkinson",
		homeRegion: "deu1",
		countryCode: "GB",
	},
	// Ravenclaw
	{
		email: "luna@hub.example",
		displayName: "Luna Lovegood",
		homeRegion: "deu1",
		countryCode: "GB",
	},
	{
		email: "cho@hub.example",
		displayName: "Cho Chang",
		homeRegion: "ind1",
		countryCode: "GB",
	},
	// Hufflepuff
	{
		email: "cedric@hub.example",
		displayName: "Cedric Diggory",
		homeRegion: "usa1",
		countryCode: "GB",
	},
	{
		email: "hannah@hub.example",
		displayName: "Hannah Abbott",
		homeRegion: "ind1",
		countryCode: "GB",
	},
];

// One superadmin per house org, using admin@<housename>.example
const ORG_ADMINS: OrgAdmin[] = [
	{ email: "admin@gryffindor.example", homeRegion: "ind1" },
	{ email: "admin@slytherin.example", homeRegion: "usa1" },
	{ email: "admin@ravenclaw.example", homeRegion: "deu1" },
	{ email: "admin@hufflepuff.example", homeRegion: "ind1" },
];

interface AgencyListingSeed {
	headline: string;
	description: string;
	capabilities: string[];
}

interface AgencySeed {
	email: string;
	domain: string;
	homeRegion: "ind1" | "usa1" | "deu1";
	listing: AgencyListingSeed;
}

// Floo Network Staffing — a wizarding-world recruitment agency that supplies
// pre-screened applicants (the 'staffing' capability) and runs background checks
// (the 'background-verification' / BGV capability). It lives in its own org so the
// marketplace + agency-referrals flows have a real provider to exercise: it publishes
// a marketplace listing and Gryffindor subscribes to it (see seedAgency /
// subscribeToAgency).
const AGENCY: AgencySeed = {
	email: "admin@floonetwork.example",
	domain: "floonetwork.example",
	homeRegion: "ind1",
	listing: {
		headline: "Floo Network Staffing — pre-screened wizarding talent on tap",
		description:
			"Full-service recruitment for the magical workforce. We source, screen and refer vetted candidates straight into your open roles, and run thorough background verification (employment history, O.W.L./N.E.W.T. credentials and prior-employer references) so you hire with confidence. Trusted by Hogwarts houses and Ministry departments alike.",
		capabilities: ["staffing", "background-verification"],
	},
};

// Floo Network Staffing employees. The agency originally shipped with only its
// superadmin (admin@floonetwork.example); these few staff give it a small but realistic
// team so the agency-referrals + marketplace flows have more than one actor. Kept
// deliberately small (one of each meaningful role combination). They are invited after
// the agency is upgraded to silver (org_users cap rises from 5 to 25).
const AGENCY_INVITEES: OrgInvitee[] = [
	// A recruiter who sources and refers candidates into subscribed orgs' openings.
	{
		email: "tonks@floonetwork.example",
		fullName: "Nymphadora Tonks",
		roles: ["org:refer_candidates", "org:view_agency_referrals"],
	},
	// A senior recruiter who also manages the agency's marketplace listings.
	{
		email: "kingsley@floonetwork.example",
		fullName: "Kingsley Shacklebolt",
		roles: [
			"org:refer_candidates",
			"org:view_agency_referrals",
			"org:manage_listings",
		],
	},
	// An account manager who owns the subscription relationships with consumer orgs.
	{
		email: "amelia@floonetwork.example",
		fullName: "Amelia Bones",
		roles: ["org:view_agency_referrals", "org:manage_subscriptions"],
	},
];

// Gryffindor office address.
const GRYFFINDOR_ADDRESS: OrgAddressSeed = {
	title: "Gryffindor Tower",
	address_line1: "Hogwarts Castle, Gryffindor Tower",
	address_line2: "Seventh Floor",
	city: "Hogsmeade",
	state: "Scottish Highlands",
	postal_code: "HG1 1GR",
	country: "United Kingdom",
};

// Extra Gryffindor members: the three students (Harry manages
// openings/applications, Hermione & Ron are read-only).
const GRYFFINDOR_INVITEES: OrgInvitee[] = [
	{
		email: "harry@gryffindor.example",
		fullName: "Harry Potter",
		// manage_openings/applications to do the work, plus the view_* roles the
		// create-opening form needs: it lists users (mandatory hiring manager +
		// recruiter), addresses (mandatory), and cost centers to populate pickers.
		roles: [
			"org:manage_openings",
			"org:manage_applications",
			"org:view_users",
			"org:view_addresses",
			"org:view_costcenters",
		],
	},
	{
		email: "hermione@gryffindor.example",
		fullName: "Hermione Granger",
		roles: ["org:view_openings", "org:view_applications"],
	},
	{
		email: "ron@gryffindor.example",
		fullName: "Ron Weasley",
		roles: ["org:view_openings", "org:view_applications"],
	},
	// Default non-admin user for gryffindor.example: a plain read-only member with
	// no management privileges, handy for exercising the non-superadmin / non-manager
	// experience out of the box (e.g. UI tiles and write actions hidden for read-only roles).
	{
		email: "ginny@gryffindor.example",
		fullName: "Ginny Weasley",
		roles: ["org:view_openings", "org:view_applications"],
	},
];

// Six Gryffindor openings modelled on real FAANG/Big-Tech profiles.
// Each exercises a different combination of optional fields so the UI has
// varied sample data to render across employment types, locations, salaries,
// and YOE / education requirements.
const GRYFFINDOR_OPENINGS: OrgOpeningSeed[] = [
	{
		title: "Senior Software Engineer – Distributed Systems",
		description:
			"Design and scale the infrastructure that powers Gryffindor's core platform. You will own the reliability and performance of distributed data pipelines processing millions of events per second, collaborate closely with product teams on API design, and mentor engineers across the org. Strong knowledge of consensus protocols, distributed caching, and observability tooling required.",
		employment_type: "full_time",
		work_location_type: "hybrid",
		number_of_positions: 2,
		hiring_manager_email_address: "harry@gryffindor.example",
		recruiter_email_address: "hermione@gryffindor.example",
		min_yoe: 5,
		max_yoe: 12,
		min_education_level: "bachelor",
		salary: { min_amount: 185000, max_amount: 260000, currency: "USD" },
	},
	{
		title: "Staff Machine Learning Engineer – Ranking & Personalisation",
		description:
			"Lead the development of next-generation ranking models that personalise content for 300 M+ users. You will drive the full ML lifecycle from ideation to production, set technical direction for a team of 8 engineers, and partner with research scientists on novel retrieval architectures. Deep expertise in large-scale recommender systems and a track record of shipping impactful models required.",
		employment_type: "full_time",
		work_location_type: "on_site",
		number_of_positions: 1,
		hiring_manager_email_address: "harry@gryffindor.example",
		recruiter_email_address: "hermione@gryffindor.example",
		min_yoe: 8,
		min_education_level: "master",
		salary: { min_amount: 240000, max_amount: 340000, currency: "USD" },
		internal_notes:
			"Levelling at L7/E7 equivalent. Prioritise candidates with FAANG ranking-system experience.",
	},
	{
		title: "Product Manager – Developer Platform",
		description:
			"Define and execute the roadmap for our developer-facing APIs and SDKs. Work with engineering, design, and external partners to identify platform gaps, write crisp product specs, and drive cross-functional launches. You will be the voice of the developer community internally and represent the platform externally at conferences and partner summits.",
		employment_type: "full_time",
		work_location_type: "remote",
		number_of_positions: 1,
		hiring_manager_email_address: "harry@gryffindor.example",
		recruiter_email_address: "hermione@gryffindor.example",
		min_yoe: 4,
		max_yoe: 10,
		salary: { min_amount: 160000, max_amount: 220000, currency: "USD" },
	},
	{
		title: "Site Reliability Engineer – Global Infrastructure",
		description:
			"Ensure 99.999 % availability across Gryffindor's multi-region infrastructure. Responsibilities include on-call rotation, incident command, capacity planning, and driving the SLO/SLA programme across 20+ services. You will embed with product-engineering squads to bake reliability into the SDLC from day one.",
		employment_type: "full_time",
		work_location_type: "hybrid",
		number_of_positions: 3,
		hiring_manager_email_address: "harry@gryffindor.example",
		recruiter_email_address: "hermione@gryffindor.example",
		min_yoe: 3,
		max_yoe: 8,
		min_education_level: "bachelor",
		salary: { min_amount: 155000, max_amount: 215000, currency: "USD" },
	},
	{
		title: "Security Engineer – Application Security",
		description:
			"Partner with product and infrastructure teams to identify and remediate vulnerabilities across Gryffindor's web and mobile surfaces. Own the bug-bounty programme, conduct threat modelling sessions, develop secure-coding guidelines, and respond to critical security incidents. Experience with SAST/DAST tooling and a strong understanding of OWASP Top-10 are required.",
		employment_type: "contract",
		work_location_type: "remote",
		number_of_positions: 2,
		hiring_manager_email_address: "harry@gryffindor.example",
		recruiter_email_address: "hermione@gryffindor.example",
		min_yoe: 4,
		salary: { min_amount: 130000, max_amount: 175000, currency: "USD" },
	},
	{
		title: "Software Engineering Intern – Summer 2026",
		description:
			"12-week paid internship on one of our product or infrastructure teams. You will work on a scoped project with real impact, receive mentorship from a senior engineer, and participate in intern-specific talks and social events. Ideal for penultimate-year students looking to return full-time after graduation.",
		employment_type: "internship",
		work_location_type: "on_site",
		number_of_positions: 5,
		hiring_manager_email_address: "harry@gryffindor.example",
		recruiter_email_address: "hermione@gryffindor.example",
		salary: { min_amount: 8500, max_amount: 9500, currency: "USD" },
	},
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

	// Seed Gryffindor with an extra admin, an office address and members.
	// Runs after the house orgs exist since it logs in as the Gryffindor admin.
	await seedGryffindor();

	// Seed published openings for Gryffindor. Runs after seedGryffindor so the
	// address and hired org users (hiring manager / recruiter) already exist.
	await seedGryffindorOpenings();

	// Seed the staffing agency (Floo Network Staffing) and subscribe Gryffindor to
	// its listing so the marketplace + agency-referrals flows have real data. Runs
	// after the house orgs exist since Gryffindor must already be present to subscribe.
	const agencyListingNumber = await seedAgency();
	await subscribeToAgency(agencyListingNumber);

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
	console.log(
		"\nGryffindor (gryffindor.example) extra members — log in at http://localhost:3002 (password: Password123$):"
	);
	for (const u of GRYFFINDOR_INVITEES) {
		console.log(`  ${u.email}  [${u.roles.join(", ")}]`);
	}
	console.log(`  office address: "${GRYFFINDOR_ADDRESS.title}"`);
	console.log(
		"\nStaffing agency — log in at http://localhost:3002 (password: Password123$):"
	);
	console.log(
		`  ${AGENCY.email}  →  ${AGENCY.domain}  (home: ${AGENCY.homeRegion})`
	);
	console.log(`  marketplace listing: "${AGENCY.listing.headline}"`);
	console.log(
		`  capabilities: ${AGENCY.listing.capabilities.join(", ")}; subscribed consumer: gryffindor.example`
	);
	console.log(
		"\nStaffing agency (floonetwork.example) staff — log in at http://localhost:3002 (password: Password123$):"
	);
	for (const u of AGENCY_INVITEES) {
		console.log(`  ${u.email}  [${u.roles.join(", ")}]`);
	}
}

main().catch((err) => {
	console.error("\nSeed failed:", err);
	process.exit(1);
});
