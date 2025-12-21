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
 * Creates a test admin user in the global database.
 * Each test should create its own unique user to ensure parallel test isolation.
 *
 * @param email - Unique email for the test user (use UUID to ensure uniqueness)
 * @param password - Plain text password (will be hashed with bcrypt)
 * @param status - User status, defaults to 'active'
 * @returns The created admin user ID
 */
export async function createTestAdminUser(
  email: string,
  password: string,
  status: AdminUserStatus = "active"
): Promise<string> {
  const adminUserId = randomUUID();
  const passwordHash = await bcrypt.hash(password, 10);

  await pool.query(
    `INSERT INTO admin_users (admin_user_id, email_address, password_hash, status)
     VALUES ($1, $2, $3, $4)`,
    [adminUserId, email, passwordHash, status]
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
 * Gets admin user details by email.
 *
 * @param email - Email of the admin user
 * @returns Admin user record or null if not found
 */
export async function getTestAdminUser(
  email: string
): Promise<{ admin_user_id: string; email_address: string; status: AdminUserStatus } | null> {
  const result = await pool.query(
    `SELECT admin_user_id, email_address, status FROM admin_users WHERE email_address = $1`,
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
