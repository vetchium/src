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
 * This creates an admin user and assigns them all admin roles (invite_users, manage_users).
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
		`SELECT role_id FROM roles WHERE role_name IN ('admin:invite_users', 'admin:manage_users', 'admin:manage_domains')`
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
	await pool.query(
		`UPDATE approved_domains SET deleted_at = NOW() WHERE domain_name = $1`,
		[domainName.toLowerCase()]
	);
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
 * Deletes a test org user by email.
 * Deletes from global DB only (CASCADE handles related records).
 * Regional DB cleanup is handled by the backend.
 *
 * @param email - Email of the org user to delete
 */
export async function deleteTestOrgUser(email: string): Promise<void> {
	const crypto = require("crypto");
	const emailHash = crypto.createHash("sha256").update(email).digest();

	// Get the org user to find their employer ID
	const userResult = await pool.query(
		`SELECT org_user_id, employer_id FROM org_users WHERE email_address_hash = $1`,
		[emailHash]
	);

	if (userResult.rows.length > 0) {
		const employerId = userResult.rows[0].employer_id;

		// Delete the org user (CASCADE handles sessions, etc.)
		await pool.query(`DELETE FROM org_users WHERE email_address_hash = $1`, [
			emailHash,
		]);

		// Delete the employer and associated domains
		// This will CASCADE delete global_employer_domains as well
		await pool.query(`DELETE FROM employers WHERE employer_id = $1`, [
			employerId,
		]);
	}
}

/**
 * Deletes a test employer and all associated data.
 *
 * @param employerId - Employer UUID to delete
 */
export async function deleteTestEmployer(employerId: string): Promise<void> {
	// CASCADE delete will handle org_users and global_employer_domains
	await pool.query(`DELETE FROM employers WHERE employer_id = $1`, [
		employerId,
	]);
}

/**
 * Deletes a test global employer domain.
 *
 * @param domain - Domain name to delete
 */
export async function deleteTestGlobalEmployerDomain(
	domain: string
): Promise<void> {
	await pool.query(`DELETE FROM global_employer_domains WHERE domain = $1`, [
		domain.toLowerCase(),
	]);
}

/**
 * Gets a test employer by domain.
 *
 * @param domain - Domain name
 * @returns Employer record or null if not found
 */
export async function getTestEmployerByDomain(domain: string): Promise<{
	employer_id: string;
	employer_name: string;
	region: RegionCode;
} | null> {
	const result = await pool.query(
		`SELECT e.employer_id, e.employer_name, e.region
     FROM employers e
     JOIN global_employer_domains ged ON e.employer_id = ged.employer_id
     WHERE ged.domain = $1`,
		[domain.toLowerCase()]
	);
	return result.rows[0] || null;
}

/**
 * Gets a test org user by email.
 *
 * @param email - Email of the org user
 * @returns Org user record or null if not found
 */
export async function getTestOrgUser(email: string): Promise<{
	org_user_id: string;
	employer_id: string;
	status: OrgUserStatus;
	preferred_language: LanguageCode;
	home_region: RegionCode;
} | null> {
	const crypto = require("crypto");
	const emailHash = crypto.createHash("sha256").update(email).digest();

	const result = await pool.query(
		`SELECT org_user_id, employer_id, status, preferred_language, home_region
     FROM org_users WHERE email_address_hash = $1`,
		[emailHash]
	);
	return result.rows[0] || null;
}

/**
 * Domain verification status enum matching the database enum
 */
export type DomainVerificationStatus = "PENDING" | "VERIFIED" | "FAILING";

/**
 * Creates a verified global employer domain for testing.
 * This allows testing the login flow which requires a verified domain.
 *
 * @param domain - Domain name to create
 * @param employerId - UUID of the employer to associate the domain with
 * @param region - Region code where the employer is registered
 */
export async function createTestVerifiedDomain(
	domain: string,
	employerId: string,
	region: RegionCode
): Promise<void> {
	await pool.query(
		`INSERT INTO global_employer_domains (domain, region, employer_id, status)
     VALUES ($1, $2, $3, 'VERIFIED')
     ON CONFLICT (domain) DO UPDATE SET status = 'VERIFIED'`,
		[domain.toLowerCase(), region, employerId]
	);
}

/**
 * Verifies an existing global employer domain for testing.
 * Use this after claiming a domain through the API.
 *
 * @param domain - Domain name to verify
 */
export async function verifyTestDomain(domain: string): Promise<void> {
	await pool.query(
		`UPDATE global_employer_domains SET status = 'VERIFIED' WHERE domain = $1`,
		[domain.toLowerCase()]
	);
}

/**
 * Gets global employer domain by domain name.
 *
 * @param domain - Domain name
 * @returns Domain record or null if not found
 */
export async function getTestGlobalEmployerDomain(domain: string): Promise<{
	domain: string;
	region: RegionCode;
	employer_id: string;
	status: DomainVerificationStatus;
} | null> {
	const result = await pool.query(
		`SELECT domain, region, employer_id, status
     FROM global_employer_domains WHERE domain = $1`,
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

	await pool.query(
		`UPDATE org_users SET status = $1 WHERE email_address_hash = $2`,
		[status, emailHash]
	);
}

/**
 * Generates a unique test email address for org users with a unique domain.
 * Each test gets its own domain to avoid collisions when tests run in parallel.
 *
 * @param prefix - Optional prefix for the email (default: 'org')
 * @returns An object with email and domain, e.g., 'user@org-{uuid}.test.vetchium.com'
 */
export function generateTestOrgEmail(prefix: string = "org"): {
	email: string;
	domain: string;
} {
	const uuid = randomUUID().substring(0, 8);
	const domain = `${prefix}-${uuid}.test.vetchium.com`;
	const email = `user@${domain}`;
	return { email, domain };
}

/**
 * Creates a test org user directly in the database (bypassing the API).
 * This is necessary because the org signup flow requires DNS verification
 * which cannot be performed in tests without a mock DNS server.
 *
 * Creates:
 * - An employer in the global database
 * - A verified domain in global_employer_domains
 * - An org user in the global database
 * - An org user with password hash in the regional database
 *
 * @param email - Email address for the org user
 * @param password - Plain text password (will be hashed with bcrypt)
 * @param region - Home region for the user (default: 'ind1')
 * @returns Object with email, domain, employerId, and orgUserId
 */
export async function createTestOrgUserDirect(
	email: string,
	password: string,
	region: RegionCode = "ind1",
	options?: {
		employerId?: string;
		domain?: string;
		status?: OrgUserStatus;
	}
): Promise<{
	email: string;
	domain: string;
	employerId: string;
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

	// Use provided employerId or create new employer
	let employerId = options?.employerId;
	if (!employerId) {
		// 1. Create employer in global DB
		employerId = randomUUID();
		await pool.query(
			`INSERT INTO employers (employer_id, employer_name, region)
     VALUES ($1, $2, $3)`,
			[employerId, domain, region]
		);

		// 2. Create verified domain in global DB
		await pool.query(
			`INSERT INTO global_employer_domains (domain, region, employer_id, status)
     VALUES ($1, $2, $3, 'VERIFIED')`,
			[domain, region, employerId]
		);
	}

	// 3. Create org user in global DB
	const orgUserId = randomUUID();
	const status = options?.status || "active";
	await pool.query(
		`INSERT INTO org_users (org_user_id, email_address_hash, hashing_algorithm, employer_id, status, preferred_language, home_region)
     VALUES ($1, $2, 'SHA-256', $3, $4, 'en-US', $5)`,
		[orgUserId, emailHash, employerId, status, region]
	);

	// 4. Create org user in regional DB
	const regionalPool = getRegionalPool(region);
	try {
		await regionalPool.query(
			`INSERT INTO org_users (org_user_id, email_address, employer_id, password_hash)
       VALUES ($1, $2, $3, $4)`,
			[orgUserId, email, employerId, passwordHash]
		);
	} finally {
		await regionalPool.end();
	}

	return { email, domain, employerId, orgUserId };
}

/**
 * Creates a test org user with admin privileges directly in the database.
 * This bypasses the signup API and is used for test setup.
 *
 * @param email - Email address for the org admin
 * @param password - Password for the org admin
 * @param region - Region code (defaults to 'ind1')
 * @returns An object with email, domain, employerId, and orgUserId
 */
export async function createTestOrgAdminDirect(
	email: string,
	password: string,
	region: RegionCode = "ind1",
	options?: {
		employerId?: string;
		domain?: string;
		status?: OrgUserStatus;
	}
): Promise<{
	email: string;
	domain: string;
	employerId: string;
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

	// Use provided employerId or create new employer
	let employerId = options?.employerId;
	if (!employerId) {
		// 1. Create employer in global DB
		employerId = randomUUID();
		await pool.query(
			`INSERT INTO employers (employer_id, employer_name, region)
     VALUES ($1, $2, $3)`,
			[employerId, domain, region]
		);

		// 2. Create verified domain in global DB
		await pool.query(
			`INSERT INTO global_employer_domains (domain, region, employer_id, status)
     VALUES ($1, $2, $3, 'VERIFIED')`,
			[domain, region, employerId]
		);
	}

	// 3. Create org admin user in global DB with is_admin=TRUE
	const orgUserId = randomUUID();
	const status = options?.status || "active";
	await pool.query(
		`INSERT INTO org_users (org_user_id, email_address_hash, hashing_algorithm, employer_id, is_admin, status, preferred_language, home_region)
     VALUES ($1, $2, 'SHA-256', $3, TRUE, $4, 'en-US', $5)`,
		[orgUserId, emailHash, employerId, status, region]
	);

	// 4. Create org admin user in regional DB
	const regionalPool = getRegionalPool(region);
	try {
		await regionalPool.query(
			`INSERT INTO org_users (org_user_id, email_address, employer_id, password_hash)
       VALUES ($1, $2, $3, $4)`,
			[orgUserId, email, employerId, passwordHash]
		);
	} finally {
		await regionalPool.end();
	}

	return { email, domain, employerId, orgUserId };
}

// ============================================================================
// Agency User Test Helpers
// ============================================================================

/**
 * Agency user status enum matching the database enum
 */
export type AgencyUserStatus = "active" | "disabled";

/**
 * Generates a unique test email for an agency user.
 * Each test should use a unique email to ensure parallel test isolation.
 *
 * @param prefix - Optional prefix for the domain (default: 'agency')
 * @returns An object with email and domain, e.g., 'user@agency-{uuid}.test.vetchium.com'
 */
export function generateTestAgencyEmail(prefix: string = "agency"): {
	email: string;
	domain: string;
} {
	const uuid = randomUUID().substring(0, 8);
	const domain = `${prefix}-${uuid}.test.vetchium.com`;
	const email = `user@${domain}`;
	return { email, domain };
}

/**
 * Creates a test agency user directly in the database (bypassing the API).
 * This is necessary because the agency signup flow requires DNS verification
 * which cannot be performed in tests without a mock DNS server.
 *
 * Creates:
 * - An agency in the global database
 * - A verified domain in global_agency_domains
 * - An agency user in the global database
 * - An agency user with password hash in the regional database
 *
 * @param email - Email address for the agency user
 * @param password - Plain text password (will be hashed with bcrypt)
 * @param region - Home region for the user (default: 'ind1')
 * @returns Object with email, domain, agencyId, and agencyUserId
 */
export async function createTestAgencyUserDirect(
	email: string,
	password: string,
	region: RegionCode = "ind1",
	options?: {
		agencyId?: string;
		domain?: string;
		status?: AgencyUserStatus;
	}
): Promise<{
	email: string;
	domain: string;
	agencyId: string;
	agencyUserId: string;
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

	// Use provided agencyId or create new agency
	let agencyId = options?.agencyId;
	if (!agencyId) {
		// 1. Create agency in global DB
		agencyId = randomUUID();
		await pool.query(
			`INSERT INTO agencies (agency_id, agency_name, region)
       VALUES ($1, $2, $3)`,
			[agencyId, domain, region]
		);

		// 2. Create verified domain in global DB
		await pool.query(
			`INSERT INTO global_agency_domains (domain, region, agency_id, status)
       VALUES ($1, $2, $3, 'VERIFIED')`,
			[domain, region, agencyId]
		);
	}

	// 3. Create agency user in global DB
	const agencyUserId = randomUUID();
	const status = options?.status || "active";
	await pool.query(
		`INSERT INTO agency_users (agency_user_id, email_address_hash, hashing_algorithm, agency_id, status, preferred_language, home_region)
     VALUES ($1, $2, 'SHA-256', $3, $4, 'en-US', $5)`,
		[agencyUserId, emailHash, agencyId, status, region]
	);

	// 4. Create agency user in regional DB
	const regionalPool = getRegionalPool(region);
	try {
		await regionalPool.query(
			`INSERT INTO agency_users (agency_user_id, email_address, agency_id, password_hash)
       VALUES ($1, $2, $3, $4)`,
			[agencyUserId, email, agencyId, passwordHash]
		);
	} finally {
		await regionalPool.end();
	}

	return { email, domain, agencyId, agencyUserId };
}

/**
 * Creates a test agency ADMIN user directly in the database (bypassing the API).
 * Similar to createTestAgencyUserDirect but sets is_admin=TRUE.
 *
 * Creates:
 * - An agency in the global database
 * - A verified domain in global_agency_domains
 * - An agency admin user (is_admin=TRUE) in the global database
 * - An agency admin user with password hash in the regional database
 *
 * @param email - Email address for the agency admin user
 * @param password - Plain text password (will be hashed with bcrypt)
 * @param region - Home region for the user (default: 'ind1')
 * @returns Object with email, domain, agencyId, and agencyUserId
 */
export async function createTestAgencyAdminDirect(
	email: string,
	password: string,
	region: RegionCode = "ind1",
	options?: {
		agencyId?: string;
		domain?: string;
		status?: AgencyUserStatus;
	}
): Promise<{
	email: string;
	domain: string;
	agencyId: string;
	agencyUserId: string;
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

	// Use provided agencyId or create new agency
	let agencyId = options?.agencyId;
	if (!agencyId) {
		// 1. Create agency in global DB
		agencyId = randomUUID();
		await pool.query(
			`INSERT INTO agencies (agency_id, agency_name, region)
       VALUES ($1, $2, $3)`,
			[agencyId, domain, region]
		);

		// 2. Create verified domain in global DB
		await pool.query(
			`INSERT INTO global_agency_domains (domain, region, agency_id, status)
       VALUES ($1, $2, $3, 'VERIFIED')`,
			[domain, region, agencyId]
		);
	}

	// 3. Create agency admin user in global DB with is_admin=TRUE
	const agencyUserId = randomUUID();
	const status = options?.status || "active";
	await pool.query(
		`INSERT INTO agency_users (agency_user_id, email_address_hash, hashing_algorithm, agency_id, is_admin, status, preferred_language, home_region)
     VALUES ($1, $2, 'SHA-256', $3, TRUE, $4, 'en-US', $5)`,
		[agencyUserId, emailHash, agencyId, status, region]
	);

	// 4. Create agency admin user in regional DB
	const regionalPool = getRegionalPool(region);
	try {
		await regionalPool.query(
			`INSERT INTO agency_users (agency_user_id, email_address, agency_id, password_hash)
       VALUES ($1, $2, $3, $4)`,
			[agencyUserId, email, agencyId, passwordHash]
		);
	} finally {
		await regionalPool.end();
	}

	return { email, domain, agencyId, agencyUserId };
}

/**
 * Deletes a test agency user and all associated data.
 * This will CASCADE delete the agency and agency domains.
 *
 * @param email - Email of the agency user to delete
 */
export async function deleteTestAgencyUser(email: string): Promise<void> {
	const crypto = require("crypto");
	const emailHash = crypto.createHash("sha256").update(email).digest();

	// Get the agency user to find their agency ID
	const userResult = await pool.query(
		`SELECT agency_user_id, agency_id FROM agency_users WHERE email_address_hash = $1`,
		[emailHash]
	);

	if (userResult.rows.length > 0) {
		const agencyId = userResult.rows[0].agency_id;

		// Delete the agency user (CASCADE handles sessions, etc.)
		await pool.query(`DELETE FROM agency_users WHERE email_address_hash = $1`, [
			emailHash,
		]);

		// Delete the agency and associated domains
		// This will CASCADE delete global_agency_domains as well
		await pool.query(`DELETE FROM agencies WHERE agency_id = $1`, [agencyId]);
	}
}

/**
 * Gets a test agency user by email.
 *
 * @param email - Email of the agency user
 * @returns Agency user record or null if not found
 */
export async function getTestAgencyUser(email: string): Promise<{
	agency_user_id: string;
	agency_id: string;
	status: AgencyUserStatus;
	preferred_language: LanguageCode;
	home_region: RegionCode;
} | null> {
	const crypto = require("crypto");
	const emailHash = crypto.createHash("sha256").update(email).digest();

	const result = await pool.query(
		`SELECT agency_user_id, agency_id, status, preferred_language, home_region
     FROM agency_users WHERE email_address_hash = $1`,
		[emailHash]
	);
	return result.rows[0] || null;
}

/**
 * Gets a test agency by domain.
 *
 * @param domain - Domain name
 * @returns Agency record or null if not found
 */
export async function getTestAgencyByDomain(domain: string): Promise<{
	agency_id: string;
	agency_name: string;
	region: RegionCode;
} | null> {
	const result = await pool.query(
		`SELECT a.agency_id, a.agency_name, a.region
     FROM agencies a
     JOIN global_agency_domains gad ON a.agency_id = gad.agency_id
     WHERE gad.domain = $1`,
		[domain.toLowerCase()]
	);
	return result.rows[0] || null;
}

/**
 * Updates the status of a test agency user.
 *
 * @param email - Email of the agency user to update
 * @param status - New status to set
 */
export async function updateTestAgencyUserStatus(
	email: string,
	status: AgencyUserStatus
): Promise<void> {
	const crypto = require("crypto");
	const emailHash = crypto.createHash("sha256").update(email).digest();

	await pool.query(
		`UPDATE agency_users SET status = $1 WHERE email_address_hash = $2`,
		[status, emailHash]
	);
}

// ============================================================================
// RBAC Test Helpers
// ============================================================================

/**
 * Assigns a role to an admin user.
 *
 * @param adminUserId - UUID of the admin user
 * @param roleName - Name of the role to assign (e.g., 'invite_users', 'manage_users')
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
 *
 * @param orgUserId - UUID of the org user
 * @param roleName - Name of the role to assign (e.g., 'post_jobs', 'manage_jobs')
 */
export async function assignRoleToOrgUser(
	orgUserId: string,
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

	// Assign role to org user
	await pool.query(
		`INSERT INTO org_user_roles (org_user_id, role_id)
     VALUES ($1, $2)
     ON CONFLICT (org_user_id, role_id) DO NOTHING`,
		[orgUserId, roleId]
	);
}

/**
 * Removes a role from an org user.
 *
 * @param orgUserId - UUID of the org user
 * @param roleName - Name of the role to remove
 */
export async function removeRoleFromOrgUser(
	orgUserId: string,
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

	// Remove role from org user
	await pool.query(
		`DELETE FROM org_user_roles WHERE org_user_id = $1 AND role_id = $2`,
		[orgUserId, roleId]
	);
}

/**
 * Assigns a role to an agency user.
 *
 * @param agencyUserId - UUID of the agency user
 * @param roleName - Name of the role to assign
 */
export async function assignRoleToAgencyUser(
	agencyUserId: string,
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

	// Assign role to agency user
	await pool.query(
		`INSERT INTO agency_user_roles (agency_user_id, role_id)
     VALUES ($1, $2)
     ON CONFLICT (agency_user_id, role_id) DO NOTHING`,
		[agencyUserId, roleId]
	);
}

/**
 * Removes a role from an agency user.
 *
 * @param agencyUserId - UUID of the agency user
 * @param roleName - Name of the role to remove
 */
export async function removeRoleFromAgencyUser(
	agencyUserId: string,
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

	// Remove role from agency user
	await pool.query(
		`DELETE FROM agency_user_roles WHERE agency_user_id = $1 AND role_id = $2`,
		[agencyUserId, roleId]
	);
}
