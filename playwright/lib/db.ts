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

	await pool.query(
		`INSERT INTO admin_users (admin_user_id, email_address, password_hash, status, preferred_language)
     VALUES ($1, $2, $3, $4, $5)`,
		[adminUserId, email, passwordHash, status, preferredLanguage]
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
 *
 * @param region - Region code
 * @returns PostgreSQL connection pool for the region
 */
function getRegionalPool(region: RegionCode): Pool {
	const dbName = `vetchium_regional_${region}`;
	return new Pool({
		host: "localhost",
		port: 5432,
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
	await pool.query(
		`DELETE FROM global_employer_domains WHERE domain = $1`,
		[domain.toLowerCase()]
	);
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
