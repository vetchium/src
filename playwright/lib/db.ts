import { Pool } from "pg";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";

// Database connection configuration
const pool = new Pool({
	host: "localhost",
	port: 5432,
	database: "vetchium_global",
	user: "vetchium",
	password: "vetchium_dev",
});

/**
 * Admin user status enum matching the database enum
 */
export type AdminUserStatus = "active" | "disabled";

/**
 * Supported language codes (BCP 47 format)
 */
export type LanguageCode = "en-US" | "de-DE" | "ta-IN" | string;

/**
 * Options for creating a test admin user
 */
export interface CreateTestAdminUserOptions {
	status?: AdminUserStatus;
	preferredLanguage?: LanguageCode;
	fullName?: string;
}

/**
 * Creates a test admin user in the global database.
 * Each test should create its own unique user to ensure parallel test isolation.
 *
 * @param email - Unique email for the test user (use UUID to ensure uniqueness)
 * @param password - Plain text password (will be hashed with bcrypt)
 * @param options - Optional settings: status (default: 'active'), preferredLanguage (default: 'en-US')
 *                  For backwards compatibility, also accepts AdminUserStatus string directly
 * @returns The created admin user ID
 */
export async function createTestAdminUser(
	email: string,
	password: string,
	options: CreateTestAdminUserOptions | AdminUserStatus = "active"
): Promise<string> {
	const adminUserId = randomUUID();
	const passwordHash = await bcrypt.hash(password, 10);

	// Handle both old signature (status string) and new signature (options object)
	const opts: CreateTestAdminUserOptions =
		typeof options === "string" ? { status: options } : options;
	const status = opts.status ?? "active";
	const preferredLanguage = opts.preferredLanguage ?? "en-US";
	const fullName = opts.fullName ?? "Test Admin";

	await pool.query(
		`INSERT INTO admin_users (admin_user_id, email_address, password_hash, status, preferred_language, full_name)
     VALUES ($1, $2, $3, $4, $5, $6)`,
		[adminUserId, email, passwordHash, status, preferredLanguage, fullName]
	);

	return adminUserId;
}

/**
 * Deletes a test admin user and all associated data (sessions, TFA tokens).
 * This should be called in afterEach/finally blocks to clean up test data.
 *
 * @param email - Email of the admin user to delete
 */
export async function deleteTestAdminUser(email: string): Promise<void> {
	// CASCADE delete will handle admin_sessions and admin_tfa_tokens
	await pool.query(`DELETE FROM admin_users WHERE email_address = $1`, [email]);
}

/**
 * Updates the status of a test admin user.
 * Useful for testing disabled admin login scenarios.
 *
 * @param email - Email of the admin user to update
 * @param status - New status to set
 */
export async function updateTestAdminUserStatus(
	email: string,
	status: AdminUserStatus
): Promise<void> {
	await pool.query(
		`UPDATE admin_users SET status = $1 WHERE email_address = $2`,
		[status, email]
	);
}

/**
 * Gets all active admin user IDs except the specified one.
 * Used for testing "last admin" protection scenarios.
 *
 * @param excludeAdminId - Admin ID to exclude from the result
 * @returns Array of admin user IDs that are currently active
 */
export async function getAllActiveAdminIds(
	excludeAdminId?: string
): Promise<string[]> {
	let query = `SELECT admin_user_id FROM admin_users WHERE status = 'active'`;
	const params: string[] = [];

	if (excludeAdminId) {
		query += ` AND admin_user_id != $1`;
		params.push(excludeAdminId);
	}

	const result = await pool.query(query, params);
	return result.rows.map((row) => row.admin_user_id);
}

/**
 * Gets all active admin user IDs that have a specific role.
 * Used for testing last-superadmin protection scenarios.
 *
 * @param roleName - The role name to filter by (e.g. "admin:superadmin")
 * @param excludeAdminId - Optional admin ID to exclude from results
 * @returns Array of admin user ID strings
 */
export async function getAllActiveAdminIdsWithRole(
	roleName: string,
	excludeAdminId?: string
): Promise<string[]> {
	let query = `
    SELECT au.admin_user_id
    FROM admin_users au
    JOIN admin_user_roles aur ON aur.admin_user_id = au.admin_user_id
    JOIN roles r ON r.role_id = aur.role_id
    WHERE au.status = 'active'
      AND r.role_name = $1`;
	const params: (string | string[])[] = [roleName];

	if (excludeAdminId) {
		query += ` AND au.admin_user_id != $2`;
		params.push(excludeAdminId);
	}

	const result = await pool.query(query, params);
	return result.rows.map((row: { admin_user_id: string }) => row.admin_user_id);
}

/**
 * Updates the status of multiple admin users by their IDs.
 * Used for testing "last admin" protection scenarios.
 *
 * @param adminIds - Array of admin user IDs to update
 * @param status - New status to set
 */
export async function updateAdminUserStatusByIds(
	adminIds: string[],
	status: AdminUserStatus
): Promise<void> {
	if (adminIds.length === 0) return;

	await pool.query(
		`UPDATE admin_users SET status = $1 WHERE admin_user_id = ANY($2::uuid[])`,
		[status, adminIds]
	);
}

/**
 * Counts the number of active admin users.
 * Used to verify "last admin" protection state.
 *
 * @returns Number of active admin users
 */
export async function countActiveAdminUsers(): Promise<number> {
	const result = await pool.query(
		`SELECT COUNT(*) as count FROM admin_users WHERE status = 'active'`
	);
	return parseInt(result.rows[0].count);
}

/**
 * Updates the preferred language of a test admin user.
 *
 * @param email - Email of the admin user to update
 * @param preferredLanguage - New preferred language (BCP 47 format)
 */
export async function updateTestAdminUserLanguage(
	email: string,
	preferredLanguage: LanguageCode
): Promise<void> {
	await pool.query(
		`UPDATE admin_users SET preferred_language = $1 WHERE email_address = $2`,
		[preferredLanguage, email]
	);
}

/**
 * Creates a test admin user with admin roles directly in the database.
 * This creates an admin user and assigns them all admin roles (manage_users, manage_domains).
 *
 * @param email - Email address for the admin user
 * @param password - Plain text password (will be hashed with bcrypt)
 * @param options - Optional settings: status (default: 'active'), preferredLanguage (default: 'en-US')
 * @returns Object with adminUserId
 */
export async function createTestAdminAdminDirect(
	email: string,
	password: string,
	options: CreateTestAdminUserOptions | AdminUserStatus = "active"
): Promise<{ userId: string }> {
	const adminUserId = await createTestAdminUser(email, password, options);

	// Get all role IDs
	const rolesResult = await pool.query(
		`SELECT role_id FROM roles WHERE role_name IN ('admin:manage_users', 'admin:manage_domains', 'admin:view_audit_logs')`
	);

	// Assign all roles to the admin user
	for (const row of rolesResult.rows) {
		await pool.query(
			`INSERT INTO admin_user_roles (admin_user_id, role_id) VALUES ($1, $2)`,
			[adminUserId, row.role_id]
		);
	}

	return { userId: adminUserId };
}

/**
 * Creates a test admin user without admin roles directly in the database.
 * This creates a regular admin user without any roles assigned.
 *
 * @param email - Email address for the admin user
 * @param password - Plain text password (will be hashed with bcrypt)
 * @param options - Optional settings: status (default: 'active'), preferredLanguage (default: 'en-US')
 * @returns Object with userId
 */
export async function createTestAdminUserDirect(
	email: string,
	password: string,
	options: CreateTestAdminUserOptions | AdminUserStatus = "active"
): Promise<{ userId: string }> {
	const adminUserId = await createTestAdminUser(email, password, options);
	return { userId: adminUserId };
}

/**
 * Gets admin user details by email.
 *
 * @param email - Email of the admin user
 * @returns Admin user record or null if not found
 */
export async function getTestAdminUser(email: string): Promise<{
	admin_user_id: string;
	email_address: string;
	status: AdminUserStatus;
	preferred_language: LanguageCode;
} | null> {
	const result = await pool.query(
		`SELECT admin_user_id, email_address, status, preferred_language FROM admin_users WHERE email_address = $1`,
		[email]
	);
	return result.rows[0] || null;
}

/**
 * Generates a unique test email address with UUID.
 * Use this to ensure each test has an isolated admin user.
 *
 * @param prefix - Optional prefix for the email (default: 'admin')
 * @returns A unique email address like 'admin-{uuid}@test.vetchium.com'
 */
export function generateTestEmail(prefix: string = "admin"): string {
	return `${prefix}-${randomUUID()}@test.vetchium.com`;
}

/**
 * Alias for generateTestEmail for admin-specific tests.
 * Generates a unique test email address for admin users.
 *
 * @param prefix - Optional prefix for the email (default: 'admin')
 * @returns A unique email address like 'admin-{uuid}@test.vetchium.com'
 */
export function generateTestAdminEmail(prefix: string = "admin"): string {
	return generateTestEmail(prefix);
}

/**
 * Closes the database connection pool.
 * Should be called when tests are complete.
 */
export async function closePool(): Promise<void> {
	await pool.end();
}

// ============================================================================
// Approved Domains Test Helpers
// ============================================================================

/**
 * Creates a test approved domain in the global database.
 *
 * @param domainName - Domain name to approve
 * @param adminEmail - Email of the admin creating this domain
 * @returns The created domain ID
 */
export async function createTestApprovedDomain(
	domainName: string,
	adminEmail: string
): Promise<string> {
	// Get admin user ID
	const adminResult = await pool.query(
		`SELECT admin_user_id FROM admin_users WHERE email_address = $1`,
		[adminEmail]
	);
	if (adminResult.rows.length === 0) {
		throw new Error(`Admin user not found: ${adminEmail}`);
	}
	const adminId = adminResult.rows[0].admin_user_id;

	const result = await pool.query(
		`INSERT INTO approved_domains (domain_name, created_by_admin_id)
     VALUES ($1, $2)
     RETURNING domain_id`,
		[domainName.toLowerCase(), adminId]
	);
	return result.rows[0].domain_id;
}

/**
 * Deletes a test approved domain.
 * This should be called in afterEach/finally blocks to clean up test data.
 *
 * @param domainName - Domain name to delete (will be soft-deleted)
 */
export async function deleteTestApprovedDomain(
	domainName: string
): Promise<void> {
	await pool.query(`DELETE FROM approved_domains WHERE domain_name = $1`, [
		domainName.toLowerCase(),
	]);
}

/**
 * Permanently deletes a test approved domain (hard delete).
 * Use this for cleanup when soft delete is not desired.
 *
 * @param domainName - Domain name to permanently delete
 */
export async function permanentlyDeleteTestApprovedDomain(
	domainName: string
): Promise<void> {
	await pool.query(`DELETE FROM approved_domains WHERE domain_name = $1`, [
		domainName.toLowerCase(),
	]);
}

/**
 * Gets audit logs for a specific domain.
 *
 * @param domainName - Domain name to get audit logs for
 * @returns Array of audit log records
 */
export async function getApprovedDomainAuditLogs(domainName: string): Promise<
	Array<{
		audit_id: string;
		admin_id: string;
		action: string;
		target_domain_name: string;
		reason: string | null;
		created_at: Date;
	}>
> {
	const result = await pool.query(
		`SELECT audit_id, admin_id, action, target_domain_name, reason, created_at
     FROM approved_domains_audit_log
     WHERE target_domain_name = $1
     ORDER BY created_at DESC`,
		[domainName.toLowerCase()]
	);
	return result.rows;
}

/**
 * Generates a unique test domain name with UUID.
 * Use this to ensure each test has an isolated approved domain.
 *
 * @param prefix - Optional prefix for the domain (default: 'test')
 * @returns A unique domain name like 'test-{uuid}.example.com'
 */
export function generateTestDomainName(prefix: string = "test"): string {
	return `${prefix}-${randomUUID().substring(0, 8)}.example.com`;
}

// ============================================================================
// Hub User Test Helpers
// ============================================================================

/**
 * Hub user status enum matching the database enum
 */
export type HubUserStatus = "active" | "disabled";

/**
 * Region code enum matching the database enum
 */
export type RegionCode = "ind1" | "usa1" | "deu1" | "sgp1";

/**
 * Creates a test hub user in both global and regional databases.
 *
 * NOTE: This function requires regional databases to be available.
 * For API tests, use the signup API flow instead of this helper.
 * This is kept for potential integration tests with full multi-region setup.
 *
 * @param email - Unique email for the test user (use generateTestEmail)
 * @param password - Plain text password (will be hashed with bcrypt)
 * @param homeRegion - Home region for the user (default: 'ind1')
 * @param status - User status (default: 'active')
 * @returns The created hub user global ID
 */
export async function createTestHubUser(
	email: string,
	password: string,
	homeRegion: RegionCode = "ind1",
	status: HubUserStatus = "active"
): Promise<string> {
	throw new Error(
		"createTestHubUser requires regional databases which are not available in test environment. " +
			"Use the signup API flow (requestSignup + completeSignup) instead to create test users."
	);
}

/**
 * Deletes a test hub user by email.
 * Deletes from global DB only (CASCADE handles related records).
 * Regional DB cleanup is handled by the backend.
 *
 * @param email - Email of the hub user to delete
 */
export async function deleteTestHubUser(email: string): Promise<void> {
	const crypto = require("crypto");
	const emailHash = crypto.createHash("sha256").update(email).digest();

	// Delete from global DB (CASCADE will handle sessions, display names, tokens, etc.)
	await pool.query(`DELETE FROM hub_users WHERE email_address_hash = $1`, [
		emailHash,
	]);
}

/**
 * Updates the status of a test hub user.
 *
 * @param email - Email of the hub user to update
 * @param status - New status to set
 */
export async function updateTestHubUserStatus(
	email: string,
	status: HubUserStatus
): Promise<void> {
	const crypto = require("crypto");
	const emailHash = crypto.createHash("sha256").update(email).digest();

	// Get home_region from global
	const globalResult = await pool.query(
		`SELECT home_region FROM hub_users WHERE email_address_hash = $1`,
		[emailHash]
	);
	if (globalResult.rows.length === 0) {
		throw new Error(`Hub user not found in global DB: ${email}`);
	}
	const region = globalResult.rows[0].home_region as RegionCode;

	// Update status in regional DB
	const regionalPool = getRegionalPool(region);
	try {
		await regionalPool.query(
			`UPDATE hub_users SET status = $1 WHERE email_address = $2`,
			[status, email]
		);
	} finally {
		await regionalPool.end();
	}
}

/**
 * Gets a regional database pool based on region code.
 * Uses the correct port for each regional database:
 * - ind1: port 5433
 * - usa1: port 5434
 * - deu1: port 5435
 *
 * @param region - Region code
 * @returns PostgreSQL connection pool for the region
 */
function getRegionalPool(region: RegionCode): Pool {
	const portMap: Record<RegionCode, number> = {
		ind1: 5433,
		usa1: 5434,
		deu1: 5435,
		sgp1: 5436, // Reserved for future use
	};
	const port = portMap[region] || 5433;
	// Database name is vetchium_<region> (e.g., vetchium_ind1)
	const dbName = `vetchium_${region}`;
	return new Pool({
		host: "localhost",
		port: port,
		database: dbName,
		user: "vetchium",
		password: "vetchium_dev",
	});
}

/**
 * Extracts the signup link (token) from a signup verification email.
 *
 * @param emailMessage - Email message from mailpit
 * @returns The signup token extracted from the link
 */
export function extractSignupTokenFromEmail(emailMessage: any): string | null {
	const html = emailMessage.HTML || "";
	// Look for the signup link pattern: /signup/verify?token=...
	const match = html.match(/token=([a-f0-9]{64})/);
	return match ? match[1] : null;
}

// ============================================================================
// Org User Test Helpers
// ============================================================================

/**
 * Org user status enum matching the database enum
 */
export type OrgUserStatus = "active" | "disabled";

/**
 * Deletes a test org user ONLY, without deleting the org.
 * Use this when multiple users share the same org.
 * Cleans up both global and regional databases.
 *
 * @param email - Email of the org user to delete
 */
export async function deleteTestOrgUserOnly(email: string): Promise<void> {
	const crypto = require("crypto");
	const emailHash = crypto.createHash("sha256").update(email).digest();

	// Get the user's region and ID before deleting from global
	const userResult = await pool.query(
		`SELECT org_user_id, home_region FROM org_users WHERE email_address_hash = $1`,
		[emailHash]
	);

	if (userResult.rows.length > 0) {
		const region = userResult.rows[0].home_region as RegionCode;
		const orgUserId = userResult.rows[0].org_user_id;

		// Delete from regional DB first
		const regionalPool = getRegionalPool(region);
		try {
			await regionalPool.query(`DELETE FROM org_users WHERE org_user_id = $1`, [
				orgUserId,
			]);
		} finally {
			await regionalPool.end();
		}
	}

	// Delete from global DB
	await pool.query(`DELETE FROM org_users WHERE email_address_hash = $1`, [
		emailHash,
	]);
}

/**
 * Deletes a test org user by email.
 * Deletes from global DB only (CASCADE handles related records).
 * Regional DB cleanup is handled by the backend.
 *
 * @param email - Email of the org user to delete
 */
export async function deleteTestOrgUser(email: string): Promise<void> {
	const crypto = require("crypto");
	const emailHash = crypto.createHash("sha256").update(email).digest();

	// Get the org user to find their org ID and region
	const userResult = await pool.query(
		`SELECT org_user_id, org_id, home_region FROM org_users WHERE email_address_hash = $1`,
		[emailHash]
	);

	if (userResult.rows.length > 0) {
		const orgId = userResult.rows[0].org_id;
		const region = userResult.rows[0].home_region as RegionCode;
		const orgUserId = userResult.rows[0].org_user_id;

		// Delete from regional DB first (CASCADE handles sessions, roles, etc.)
		const regionalPool = getRegionalPool(region);
		try {
			await regionalPool.query(`DELETE FROM org_users WHERE org_user_id = $1`, [
				orgUserId,
			]);
			// Also clean up regional org_domains
			await regionalPool.query(
				`DELETE FROM org_domains WHERE org_id = $1`,
				[orgId]
			);
		} finally {
			await regionalPool.end();
		}

		// Delete from global DB
		await pool.query(`DELETE FROM org_users WHERE email_address_hash = $1`, [
			emailHash,
		]);

		// Delete the org and associated domains
		// This will CASCADE delete global_org_domains as well
		await pool.query(`DELETE FROM orgs WHERE org_id = $1`, [
			orgId,
		]);
	}
}

/**
 * Deletes a test org and all associated data.
 *
 * @param orgId - Org UUID to delete
 */
export async function deleteTestOrg(orgId: string): Promise<void> {
	// CASCADE delete will handle org_users and global_org_domains
	await pool.query(`DELETE FROM orgs WHERE org_id = $1`, [
		orgId,
	]);
}

/**
 * Deletes a test global org domain.
 *
 * @param domain - Domain name to delete
 */
export async function deleteTestGlobalOrgDomain(
	domain: string
): Promise<void> {
	await pool.query(`DELETE FROM global_org_domains WHERE domain = $1`, [
		domain.toLowerCase(),
	]);
}

/**
 * Gets a test org by domain.
 *
 * @param domain - Domain name
 * @returns Org record or null if not found
 */
export async function getTestOrgByDomain(domain: string): Promise<{
	org_id: string;
	org_name: string;
	region: RegionCode;
} | null> {
	const result = await pool.query(
		`SELECT o.org_id, o.org_name, o.region
     FROM orgs o
     JOIN global_org_domains god ON o.org_id = god.org_id
     WHERE god.domain = $1`,
		[domain.toLowerCase()]
	);
	return result.rows[0] || null;
}

/**
 * Deletes a test org and all associated data (global + regional) by domain.
 * Safe to call even if the domain is not registered (no-op).
 *
 * @param domain - Domain name to clean up (e.g., "example.com")
 */
export async function deleteTestOrgByDomain(
	domain: string
): Promise<void> {
	const result = await pool.query(
		`SELECT o.org_id, o.region
     FROM orgs o
     JOIN global_org_domains god ON o.org_id = god.org_id
     WHERE god.domain = $1`,
		[domain.toLowerCase()]
	);

	if (result.rows.length === 0) {
		return;
	}

	const { org_id, region } = result.rows[0];

	const regionalPool = getRegionalPool(region as RegionCode);
	try {
		await regionalPool.query(`DELETE FROM org_users WHERE org_id = $1`, [
			org_id,
		]);
		await regionalPool.query(
			`DELETE FROM org_domains WHERE org_id = $1`,
			[org_id]
		);
	} finally {
		await regionalPool.end();
	}

	// Cascades to global org_users and global_org_domains
	await pool.query(`DELETE FROM orgs WHERE org_id = $1`, [
		org_id,
	]);
}

/**
 * Gets a test org user by email.
 *
 * @param email - Email of the org user
 * @returns Org user record or null if not found
 */
export async function getTestOrgUser(email: string): Promise<{
	org_user_id: string;
	org_id: string;
	status: OrgUserStatus;
	preferred_language: LanguageCode;
	home_region: RegionCode;
} | null> {
	const crypto = require("crypto");
	const emailHash = crypto.createHash("sha256").update(email).digest();

	// Get routing data from global
	const globalResult = await pool.query(
		`SELECT org_user_id, org_id, home_region
     FROM org_users WHERE email_address_hash = $1`,
		[emailHash]
	);
	if (globalResult.rows.length === 0) return null;

	const globalUser = globalResult.rows[0];
	const region = globalUser.home_region as RegionCode;

	// Get mutable data from regional
	const regionalPool = getRegionalPool(region);
	try {
		const regionalResult = await regionalPool.query(
			`SELECT status, preferred_language FROM org_users WHERE org_user_id = $1`,
			[globalUser.org_user_id]
		);
		if (regionalResult.rows.length === 0) return null;

		return {
			org_user_id: globalUser.org_user_id,
			org_id: globalUser.org_id,
			home_region: region,
			status: regionalResult.rows[0].status,
			preferred_language: regionalResult.rows[0].preferred_language,
		};
	} finally {
		await regionalPool.end();
	}
}

/**
 * Domain verification status enum matching the database enum
 */
export type DomainVerificationStatus = "PENDING" | "VERIFIED" | "FAILING";

/**
 * Creates a verified global org domain for testing.
 * This allows testing the login flow which requires a verified domain.
 *
 * @param domain - Domain name to create
 * @param orgId - UUID of the org to associate the domain with
 * @param region - Region code where the org is registered
 */
export async function createTestVerifiedDomain(
	domain: string,
	orgId: string,
	region: RegionCode
): Promise<void> {
	// Create domain in global DB (routing only, no status column)
	await pool.query(
		`INSERT INTO global_org_domains (domain, region, org_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (domain) DO NOTHING`,
		[domain.toLowerCase(), region, orgId]
	);

	// Create verified domain in regional DB (operational data with status)
	const regionalPool = getRegionalPool(region);
	try {
		await regionalPool.query(
			`INSERT INTO org_domains (domain, org_id, verification_token, token_expires_at, status)
       VALUES ($1, $2, 'test-token', NOW() + INTERVAL '1 year', 'VERIFIED')
       ON CONFLICT (domain) DO UPDATE SET status = 'VERIFIED'`,
			[domain.toLowerCase(), orgId]
		);
	} finally {
		await regionalPool.end();
	}
}

/**
 * Verifies an existing global org domain for testing.
 * Use this after claiming a domain through the API.
 *
 * @param domain - Domain name to verify
 */
export async function verifyTestDomain(domain: string): Promise<void> {
	// Get region from global domain record
	const result = await pool.query(
		`SELECT region FROM global_org_domains WHERE domain = $1`,
		[domain.toLowerCase()]
	);
	if (result.rows.length === 0) {
		throw new Error(`Domain not found in global DB: ${domain}`);
	}
	const region = result.rows[0].region as RegionCode;

	// Update status in regional org_domains
	const regionalPool = getRegionalPool(region);
	try {
		await regionalPool.query(
			`UPDATE org_domains SET status = 'VERIFIED' WHERE domain = $1`,
			[domain.toLowerCase()]
		);
	} finally {
		await regionalPool.end();
	}
}

/**
 * Gets global org domain by domain name.
 *
 * @param domain - Domain name
 * @returns Domain record or null if not found
 */
export async function getTestGlobalOrgDomain(domain: string): Promise<{
	domain: string;
	region: RegionCode;
	org_id: string;
} | null> {
	const result = await pool.query(
		`SELECT domain, region, org_id
     FROM global_org_domains WHERE domain = $1`,
		[domain.toLowerCase()]
	);
	return result.rows[0] || null;
}

/**
 * Updates the status of a test org user.
 *
 * @param email - Email of the org user to update
 * @param status - New status to set
 */
export async function updateTestOrgUserStatus(
	email: string,
	status: OrgUserStatus
): Promise<void> {
	const crypto = require("crypto");
	const emailHash = crypto.createHash("sha256").update(email).digest();

	// Get home_region from global
	const globalResult = await pool.query(
		`SELECT home_region FROM org_users WHERE email_address_hash = $1`,
		[emailHash]
	);
	if (globalResult.rows.length === 0) {
		throw new Error(`Org user not found in global DB: ${email}`);
	}
	const region = globalResult.rows[0].home_region as RegionCode;

	// Update status in regional DB
	const regionalPool = getRegionalPool(region);
	try {
		await regionalPool.query(
			`UPDATE org_users SET status = $1 WHERE email_address = $2`,
			[status, email]
		);
	} finally {
		await regionalPool.end();
	}
}

/**
 * Generates a unique test email address for org users with a unique domain.
 * Each test gets its own domain to avoid collisions when tests run in parallel.
 *
 * @param prefix - Optional prefix for the email (default: 'org')
 * @returns An object with email and domain, e.g., 'user@org-{uuid}.test.vetchium.com'
 */
export function generateTestOrgEmail(
	prefix: string = "org",
	customDomain?: string
): {
	email: string;
	domain: string;
} {
	const domain =
		customDomain ||
		`${prefix}-${randomUUID().substring(0, 8)}.test.vetchium.com`;
	const email = `user@${domain}`;
	return { email, domain };
}

/**
 * Creates a test org user directly in the database (bypassing the API).
 * This is necessary because the org signup flow requires DNS verification
 * which cannot be performed in tests without a mock DNS server.
 *
 * Creates:
 * - An org in the global database
 * - A verified domain in global_org_domains
 * - An org user in the global database
 * - An org user with password hash in the regional database
 *
 * @param email - Email address for the org user
 * @param password - Plain text password (will be hashed with bcrypt)
 * @param region - Home region for the user (default: 'ind1')
 * @returns Object with email, domain, orgId, and orgUserId
 */
export async function createTestOrgUserDirect(
	email: string,
	password: string,
	region: RegionCode = "ind1",
	options?: {
		orgId?: string;
		domain?: string;
		status?: OrgUserStatus;
	}
): Promise<{
	email: string;
	domain: string;
	orgId: string;
	orgUserId: string;
}> {
	const crypto = require("crypto");
	const emailHash = crypto.createHash("sha256").update(email).digest();
	const passwordHash = await bcrypt.hash(password, 10);

	// Extract domain from email or use provided domain
	let domain = options?.domain;
	if (!domain) {
		const parts = email.split("@");
		if (parts.length !== 2) {
			throw new Error(`Invalid email format: ${email}`);
		}
		domain = parts[1].toLowerCase();
	}

	// Use provided orgId or create new org
	let orgId = options?.orgId;
	if (!orgId) {
		// 1. Create org in global DB
		orgId = randomUUID();
		await pool.query(
			`INSERT INTO orgs (org_id, org_name, region)
     VALUES ($1, $2, $3)`,
			[orgId, domain, region]
		);

		// 2. Create verified domain in global DB
		await pool.query(
			`INSERT INTO global_org_domains (domain, region, org_id)
     VALUES ($1, $2, $3)`,
			[domain, region, orgId]
		);
	}

	// 3. Create org user in global DB (routing only)
	const orgUserId = randomUUID();
	const status = options?.status || "active";
	await pool.query(
		`INSERT INTO org_users (org_user_id, email_address_hash, hashing_algorithm, org_id, home_region)
     VALUES ($1, $2, 'SHA-256', $3, $4)`,
		[orgUserId, emailHash, orgId, region]
	);

	// 4. Create org user in regional DB (mutable data)
	const regionalPool = getRegionalPool(region);
	try {
		await regionalPool.query(
			`INSERT INTO org_users (org_user_id, email_address, org_id, password_hash, status)
       VALUES ($1, $2, $3, $4, $5)`,
			[orgUserId, email, orgId, passwordHash, status]
		);
	} finally {
		await regionalPool.end();
	}

	return { email, domain, orgId, orgUserId };
}

/**
 * Creates a test org user with admin privileges directly in the database.
 * This bypasses the signup API and is used for test setup.
 *
 * @param email - Email address for the org admin
 * @param password - Password for the org admin
 * @param region - Region code (defaults to 'ind1')
 * @returns An object with email, domain, orgId, and orgUserId
 */
export async function createTestOrgAdminDirect(
	email: string,
	password: string,
	region: RegionCode = "ind1",
	options?: {
		orgId?: string;
		domain?: string;
		status?: OrgUserStatus;
	}
): Promise<{
	email: string;
	domain: string;
	orgId: string;
	orgUserId: string;
}> {
	const crypto = require("crypto");
	const emailHash = crypto.createHash("sha256").update(email).digest();
	const passwordHash = await bcrypt.hash(password, 10);

	// Extract domain from email or use provided domain
	let domain = options?.domain;
	if (!domain) {
		const parts = email.split("@");
		if (parts.length !== 2) {
			throw new Error(`Invalid email format: ${email}`);
		}
		domain = parts[1].toLowerCase();
	}

	// Use provided orgId or create new org
	let orgId = options?.orgId;
	if (!orgId) {
		// 1. Create org in global DB
		orgId = randomUUID();
		await pool.query(
			`INSERT INTO orgs (org_id, org_name, region)
     VALUES ($1, $2, $3)`,
			[orgId, domain, region]
		);

		// 2. Create verified domain in global DB
		await pool.query(
			`INSERT INTO global_org_domains (domain, region, org_id)
     VALUES ($1, $2, $3)`,
			[domain, region, orgId]
		);
	}

	// 3. Create org admin user in global DB (routing only)
	const orgUserId = randomUUID();
	const status = options?.status || "active";
	await pool.query(
		`INSERT INTO org_users (org_user_id, email_address_hash, hashing_algorithm, org_id, home_region)
     VALUES ($1, $2, 'SHA-256', $3, $4)`,
		[orgUserId, emailHash, orgId, region]
	);

	// 4. Create org admin user in regional DB (mutable data)
	const regionalPool = getRegionalPool(region);
	try {
		await regionalPool.query(
			`INSERT INTO org_users (org_user_id, email_address, org_id, password_hash, status)
       VALUES ($1, $2, $3, $4, $5)`,
			[orgUserId, email, orgId, passwordHash, status]
		);
		// Assign superadmin role
		await regionalPool.query(
			`INSERT INTO org_user_roles (org_user_id, role_id)
       SELECT $1, role_id FROM roles WHERE role_name = 'org:superadmin'`,
			[orgUserId]
		);
	} finally {
		await regionalPool.end();
	}

	return { email, domain, orgId, orgUserId };
}

// ============================================================================
// RBAC Test Helpers
// ============================================================================

/**
 * Assigns a role to an admin user.
 *
 * @param adminUserId - UUID of the admin user
 * @param roleName - Name of the role to assign (e.g., 'manage_users', 'manage_domains')
 */
export async function assignRoleToAdminUser(
	adminUserId: string,
	roleName: string
): Promise<void> {
	// Get role ID from role name
	const roleResult = await pool.query(
		`SELECT role_id FROM roles WHERE role_name = $1`,
		[roleName]
	);

	if (roleResult.rows.length === 0) {
		throw new Error(`Role not found: ${roleName}`);
	}

	const roleId = roleResult.rows[0].role_id;

	// Assign role to admin user
	await pool.query(
		`INSERT INTO admin_user_roles (admin_user_id, role_id)
     VALUES ($1, $2)
     ON CONFLICT (admin_user_id, role_id) DO NOTHING`,
		[adminUserId, roleId]
	);
}

/**
 * Removes a role from an admin user.
 *
 * @param adminUserId - UUID of the admin user
 * @param roleName - Name of the role to remove
 */
export async function removeRoleFromAdminUser(
	adminUserId: string,
	roleName: string
): Promise<void> {
	// Get role ID from role name
	const roleResult = await pool.query(
		`SELECT role_id FROM roles WHERE role_name = $1`,
		[roleName]
	);

	if (roleResult.rows.length === 0) {
		throw new Error(`Role not found: ${roleName}`);
	}

	const roleId = roleResult.rows[0].role_id;

	// Remove role from admin user
	await pool.query(
		`DELETE FROM admin_user_roles WHERE admin_user_id = $1 AND role_id = $2`,
		[adminUserId, roleId]
	);
}

/**
 * Assigns a role to an org user.
 * Roles and org_user_roles are in the regional database.
 *
 * @param orgUserId - UUID of the org user
 * @param roleName - Name of the role to assign (e.g., 'post_jobs', 'manage_jobs')
 * @param region - Region where the org user resides (default: 'ind1')
 */
export async function assignRoleToOrgUser(
	orgUserId: string,
	roleName: string,
	region: RegionCode = "ind1"
): Promise<void> {
	const regionalPool = getRegionalPool(region);
	try {
		// Get role ID from regional roles table
		const roleResult = await regionalPool.query(
			`SELECT role_id FROM roles WHERE role_name = $1`,
			[roleName]
		);

		if (roleResult.rows.length === 0) {
			throw new Error(`Role not found in region ${region}: ${roleName}`);
		}

		const roleId = roleResult.rows[0].role_id;

		// Assign role to org user in regional DB
		await regionalPool.query(
			`INSERT INTO org_user_roles (org_user_id, role_id)
       VALUES ($1, $2)
       ON CONFLICT (org_user_id, role_id) DO NOTHING`,
			[orgUserId, roleId]
		);
	} finally {
		await regionalPool.end();
	}
}

/**
 * Removes a role from an org user.
 * Roles and org_user_roles are in the regional database.
 *
 * @param orgUserId - UUID of the org user
 * @param roleName - Name of the role to remove
 * @param region - Region where the org user resides (default: 'ind1')
 */
export async function removeRoleFromOrgUser(
	orgUserId: string,
	roleName: string,
	region: RegionCode = "ind1"
): Promise<void> {
	const regionalPool = getRegionalPool(region);
	try {
		// Get role ID from regional roles table
		const roleResult = await regionalPool.query(
			`SELECT role_id FROM roles WHERE role_name = $1`,
			[roleName]
		);

		if (roleResult.rows.length === 0) {
			throw new Error(`Role not found in region ${region}: ${roleName}`);
		}

		const roleId = roleResult.rows[0].role_id;

		// Remove role from org user in regional DB
		await regionalPool.query(
			`DELETE FROM org_user_roles WHERE org_user_id = $1 AND role_id = $2`,
			[orgUserId, roleId]
		);
	} finally {
		await regionalPool.end();
	}
}

// ============================================================================
// Tag Test Helpers
// ============================================================================

/**
 * Generates a unique test tag ID.
 * Tag IDs must be lowercase letters, digits, and hyphens only,
 * with no leading or trailing hyphens.
 *
 * @param prefix - Optional prefix (default: 'tag')
 * @returns A unique tag ID like 'tag-a1b2c3d4'
 */
export function generateTestTagId(prefix: string = "tag"): string {
	const hex = randomUUID().replace(/-/g, "").substring(0, 8).toLowerCase();
	return `${prefix}-${hex}`;
}

/**
 * Creates a test tag in the global database.
 * Inserts the tag and its translations directly.
 *
 * @param tagId - The tag ID to create
 * @param translations - Array of translations (default: single en-US translation)
 */
export async function createTestTag(
	tagId: string,
	translations: Array<{
		locale: string;
		display_name: string;
		description?: string;
	}> = [{ locale: "en-US", display_name: "Test Tag" }]
): Promise<void> {
	await pool.query(`INSERT INTO tags (tag_id) VALUES ($1)`, [tagId]);
	for (const t of translations) {
		await pool.query(
			`INSERT INTO tag_translations (tag_id, locale, display_name, description)
       VALUES ($1, $2, $3, $4)`,
			[tagId, t.locale, t.display_name, t.description ?? null]
		);
	}
}

/**
 * Deletes a test tag from the global database.
 * tag_translations are cascade-deleted automatically.
 *
 * @param tagId - The tag ID to delete
 */
export async function deleteTestTag(tagId: string): Promise<void> {
	await pool.query(`DELETE FROM tags WHERE tag_id = $1`, [tagId]);
}
