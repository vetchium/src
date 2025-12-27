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
  await pool.query(`UPDATE admin_users SET status = $1 WHERE email_address = $2`, [status, email]);
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
  await pool.query(`UPDATE admin_users SET preferred_language = $1 WHERE email_address = $2`, [
    preferredLanguage,
    email,
  ]);
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
export async function createTestApprovedDomain(domainName: string, adminEmail: string): Promise<string> {
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
export async function deleteTestApprovedDomain(domainName: string): Promise<void> {
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
export async function permanentlyDeleteTestApprovedDomain(domainName: string): Promise<void> {
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
