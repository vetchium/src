/**
 * Mailpit API client for retrieving TFA codes from emails.
 *
 * Mailpit API docs: https://mailpit.axllent.org/docs/api-v1/
 * Running at: http://localhost:8025
 */

const MAILPIT_API_URL = "http://localhost:8025/api/v1";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for email waiting with exponential backoff.
 */
export interface WaitForEmailConfig {
	/** Maximum number of retry attempts (default: 5) */
	maxRetries: number;
	/** Initial delay in milliseconds before first retry (default: 1000) */
	initialDelayMs: number;
	/** Maximum delay between retries in milliseconds (default: 15000) */
	maxDelayMs: number;
	/** Multiplier for exponential backoff (default: 2) */
	backoffMultiplier: number;
}

const DEFAULT_WAIT_CONFIG: WaitForEmailConfig = {
	maxRetries: 5,
	initialDelayMs: 1000,
	maxDelayMs: 15000,
	backoffMultiplier: 2,
};

// ============================================================================
// Mailpit API Types
// ============================================================================

interface MailpitMessageSummary {
	ID: string;
	MessageID: string;
	From: { Address: string; Name: string };
	To: Array<{ Address: string; Name: string }>;
	Subject: string;
	Created: string;
	Size: number;
}

interface MailpitSearchResponse {
	messages: MailpitMessageSummary[];
	total: number;
}

interface MailpitMessage {
	ID: string;
	MessageID: string;
	From: { Address: string; Name: string };
	To: Array<{ Address: string; Name: string }>;
	Subject: string;
	Text: string;
	HTML: string;
}

// ============================================================================
// Mailpit Client Functions
// ============================================================================

/**
 * Searches for emails by recipient address.
 *
 * @param toEmail - Email address to search for in the To field
 * @returns Array of message summaries
 */
export async function searchEmails(
	toEmail: string
): Promise<MailpitMessageSummary[]> {
	const query = encodeURIComponent(`to:${toEmail}`);
	const response = await fetch(`${MAILPIT_API_URL}/search?query=${query}`);

	if (!response.ok) {
		throw new Error(
			`Mailpit search failed: ${response.status} ${response.statusText}`
		);
	}

	const data = (await response.json()) as MailpitSearchResponse;
	return data.messages || [];
}

/**
 * Gets the full content of an email by ID.
 *
 * @param messageId - The message ID from search results
 * @returns Full message with text and HTML content
 */
export async function getEmailContent(
	messageId: string
): Promise<MailpitMessage> {
	const response = await fetch(`${MAILPIT_API_URL}/message/${messageId}`);

	if (!response.ok) {
		throw new Error(
			`Mailpit get message failed: ${response.status} ${response.statusText}`
		);
	}

	return (await response.json()) as MailpitMessage;
}

/**
 * Extracts the 6-digit TFA code from an email body.
 * The TFA code is expected to be a standalone 6-digit number in the email.
 *
 * @param emailText - Plain text email body
 * @returns The 6-digit TFA code
 * @throws Error if no TFA code is found
 */
export function extractTfaCode(emailText: string): string {
	// Look for a 6-digit number that stands alone (TFA code pattern)
	const match = emailText.match(/\b(\d{6})\b/);
	if (!match) {
		throw new Error(
			`No TFA code found in email: ${emailText.substring(0, 200)}...`
		);
	}
	return match[1];
}

/**
 * Waits for an email to arrive for the specified recipient using exponential backoff.
 * Retries with increasing delays until email is found or max retries exceeded.
 *
 * @param toEmail - Email address to wait for
 * @param config - Optional configuration for retry behavior
 * @param subjectPattern - Optional regex pattern to match against email subject
 * @returns The first matching message summary
 * @throws Error if no email arrives after all retries
 *
 * @example
 * // Use defaults (5 retries, 1s initial delay, 2x backoff)
 * const email = await waitForEmail("test@example.com");
 *
 * @example
 * // Wait for password reset email specifically
 * const email = await waitForEmail("test@example.com", {}, /reset.*password/i);
 *
 * @example
 * // Custom config for slower email delivery
 * const email = await waitForEmail("test@example.com", {
 *   maxRetries: 8,
 *   initialDelayMs: 2000,
 *   maxDelayMs: 30000,
 *   backoffMultiplier: 2,
 * });
 */
export async function waitForEmail(
	toEmail: string,
	config: Partial<WaitForEmailConfig> = {},
	subjectPattern?: RegExp
): Promise<MailpitMessageSummary> {
	const cfg = { ...DEFAULT_WAIT_CONFIG, ...config };

	let delay = cfg.initialDelayMs;
	let totalWaitTime = 0;

	for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
		const messages = await searchEmails(toEmail);

		// If subject pattern provided, filter messages
		const filteredMessages = subjectPattern
			? messages.filter(msg => subjectPattern.test(msg.Subject))
			: messages;

		if (filteredMessages.length > 0) {
			// Return the most recent matching message (first in the list)
			return filteredMessages[0];
		}

		if (attempt < cfg.maxRetries) {
			// Wait before next attempt
			await sleep(delay);
			totalWaitTime += delay;

			// Calculate next delay with exponential backoff, capped at maxDelayMs
			delay = Math.min(delay * cfg.backoffMultiplier, cfg.maxDelayMs);
		}
	}

	const patternMsg = subjectPattern ? ` matching subject pattern ${subjectPattern}` : '';
	throw new Error(
		`No email received for ${toEmail}${patternMsg} after ${
			cfg.maxRetries
		} attempts (waited ~${Math.round(totalWaitTime / 1000)}s)`
	);
}

/**
 * Gets the TFA code from emails sent to the specified address.
 * Searches through all emails for the recipient to find one containing a 6-digit TFA code.
 * This handles cases where multiple emails exist (e.g., signup + TFA).
 *
 * @param toEmail - Email address to get TFA code for
 * @param config - Optional configuration for retry behavior
 * @returns The 6-digit TFA code
 */
export async function getTfaCodeFromEmail(
	toEmail: string,
	config: Partial<WaitForEmailConfig> = {}
): Promise<string> {
	const cfg = { ...DEFAULT_WAIT_CONFIG, ...config };

	let delay = cfg.initialDelayMs;
	let totalWaitTime = 0;

	for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
		const messages = await searchEmails(toEmail);

		// Search through all emails to find one with a TFA code
		for (const msg of messages) {
			const fullMessage = await getEmailContent(msg.ID);
			const match = fullMessage.Text.match(/\b(\d{6})\b/);
			if (match) {
				return match[1];
			}
		}

		if (attempt < cfg.maxRetries) {
			await sleep(delay);
			totalWaitTime += delay;
			delay = Math.min(delay * cfg.backoffMultiplier, cfg.maxDelayMs);
		}
	}

	throw new Error(
		`No TFA code email received for ${toEmail} after ${
			cfg.maxRetries
		} attempts (waited ~${Math.round(totalWaitTime / 1000)}s)`
	);
}

/**
 * Extracts the org signup token from the signup token email.
 * The token is a 64-character hex string sent in the private signup email.
 *
 * @param emailText - Plain text email body
 * @returns The 64-character signup token
 * @throws Error if no signup token is found
 */
export function extractOrgSignupToken(emailText: string): string {
	// Look for a 64-character hex string (the signup token)
	const match = emailText.match(/\b([a-f0-9]{64})\b/);
	if (!match) {
		throw new Error(
			`No signup token found in email: ${emailText.substring(0, 200)}...`
		);
	}
	return match[1];
}

/**
 * Waits for and returns both org signup emails (DNS instructions + token).
 * Returns the signup token from the private email.
 *
 * @param toEmail - Email address to wait for
 * @param config - Optional configuration for retry behavior
 * @returns The signup token from the private signup email
 */
export async function getOrgSignupTokenFromEmail(
	toEmail: string,
	config: Partial<WaitForEmailConfig> = {}
): Promise<string> {
	const cfg = { ...DEFAULT_WAIT_CONFIG, ...config };

	let delay = cfg.initialDelayMs;
	let totalWaitTime = 0;

	// Wait for TWO emails (DNS instructions + token)
	for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
		const messages = await searchEmails(toEmail);
		if (messages.length >= 2) {
			// Find the signup token email (contains "Private Link" or "DO NOT FORWARD")
			for (const msg of messages) {
				const fullMessage = await getEmailContent(msg.ID);
				if (
					fullMessage.Subject.includes("Private Link") ||
					fullMessage.Text.includes("DO NOT FORWARD")
				) {
					return extractOrgSignupToken(fullMessage.Text);
				}
			}
			// If we have 2 emails but neither matches, check all of them for the token
			for (const msg of messages) {
				const fullMessage = await getEmailContent(msg.ID);
				try {
					return extractOrgSignupToken(fullMessage.Text);
				} catch {
					// Continue to next email
				}
			}
		}

		if (attempt < cfg.maxRetries) {
			await sleep(delay);
			totalWaitTime += delay;
			delay = Math.min(delay * cfg.backoffMultiplier, cfg.maxDelayMs);
		}
	}

	throw new Error(
		`Org signup token email not received for ${toEmail} after ${
			cfg.maxRetries
		} attempts (waited ~${Math.round(totalWaitTime / 1000)}s)`
	);
}

/**
 * Extracts the agency signup token from an email body.
 * The token is a 64-character hex string sent in the private signup email.
 *
 * @param emailText - Plain text email body
 * @returns The 64-character signup token
 * @throws Error if no signup token is found
 */
export function extractAgencySignupToken(emailText: string): string {
	// Look for a 64-character hex string (the signup token)
	const match = emailText.match(/\b([a-f0-9]{64})\b/);
	if (!match) {
		throw new Error(
			`No signup token found in email: ${emailText.substring(0, 200)}...`
		);
	}
	return match[1];
}

/**
 * Waits for and returns both agency signup emails (DNS instructions + token).
 * Returns the signup token from the private email.
 *
 * @param toEmail - Email address to wait for
 * @param config - Optional configuration for retry behavior
 * @returns The signup token from the private signup email
 */
export async function getAgencySignupTokenFromEmail(
	toEmail: string,
	config: Partial<WaitForEmailConfig> = {}
): Promise<string> {
	const cfg = { ...DEFAULT_WAIT_CONFIG, ...config };

	let delay = cfg.initialDelayMs;
	let totalWaitTime = 0;

	// Wait for TWO emails (DNS instructions + token)
	for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
		const messages = await searchEmails(toEmail);
		if (messages.length >= 2) {
			// Find the signup token email (contains "Private Link" or "DO NOT FORWARD")
			for (const msg of messages) {
				const fullMessage = await getEmailContent(msg.ID);
				if (
					fullMessage.Subject.includes("Private Link") ||
					fullMessage.Text.includes("DO NOT FORWARD")
				) {
					return extractAgencySignupToken(fullMessage.Text);
				}
			}
			// If we have 2 emails but neither matches, check all of them for the token
			for (const msg of messages) {
				const fullMessage = await getEmailContent(msg.ID);
				try {
					return extractAgencySignupToken(fullMessage.Text);
				} catch {
					// Continue to next email
				}
			}
		}

		if (attempt < cfg.maxRetries) {
			await sleep(delay);
			totalWaitTime += delay;
			delay = Math.min(delay * cfg.backoffMultiplier, cfg.maxDelayMs);
		}
	}

	throw new Error(
		`Agency signup token email not received for ${toEmail} after ${
			cfg.maxRetries
		} attempts (waited ~${Math.round(totalWaitTime / 1000)}s)`
	);
}

/**
 * Deletes all emails in mailpit.
 * Useful for cleanup between tests, though with unique emails per test
 * this is usually not necessary.
 */
export async function deleteAllEmails(): Promise<void> {
	const response = await fetch(`${MAILPIT_API_URL}/messages`, {
		method: "DELETE",
	});

	if (!response.ok) {
		throw new Error(
			`Mailpit delete all failed: ${response.status} ${response.statusText}`
		);
	}
}

/**
 * Deletes emails matching a specific recipient.
 * More targeted cleanup than deleteAllEmails.
 *
 * @param toEmail - Email address to delete messages for
 */
export async function deleteEmailsFor(toEmail: string): Promise<void> {
	const messages = await searchEmails(toEmail);
	for (const msg of messages) {
		await fetch(`${MAILPIT_API_URL}/messages`, {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ IDs: [msg.ID] }),
		});
	}
}

/**
 * Extracts the password reset token from an email message.
 * Handles both admin tokens (no prefix) and regional user tokens (with prefix).
 * - Admin tokens: 64-character hex string
 * - Regional tokens: REGION-{64-char-hex} (e.g., IND1-abc123...)
 *
 * @param message - MailpitMessage object with Text field
 * @returns The reset token (with or without region prefix)
 * @throws Error if no reset token is found
 */
export function extractPasswordResetToken(message: MailpitMessage): string {
	const text = message.Text;

	// Try region-prefixed token first (for hub/org/agency users)
	const regionalMatch = text.match(/\b(IND1|USA1|DEU1)-([a-f0-9]{64})\b/);
	if (regionalMatch) {
		return regionalMatch[0];
	}

	// Try admin token (no region prefix, just 64-char hex)
	const adminMatch = text.match(/\b([a-f0-9]{64})\b/);
	if (adminMatch) {
		return adminMatch[1];
	}

	throw new Error(
		`No password reset token found in email: ${text.substring(0, 200)}...`
	);
}

/**
 * Waits for and extracts the password reset token from email.
 *
 * @param toEmail - Email address to wait for
 * @param config - Optional configuration for retry behavior
 * @returns The region-prefixed password reset token
 */
export async function getPasswordResetTokenFromEmail(
	toEmail: string,
	config: Partial<WaitForEmailConfig> = {}
): Promise<string> {
	const cfg = { ...DEFAULT_WAIT_CONFIG, ...config };

	let delay = cfg.initialDelayMs;
	let totalWaitTime = 0;

	for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
		const messages = await searchEmails(toEmail);

		// Search through emails to find one with a password reset token
		for (const msg of messages) {
			const fullMessage = await getEmailContent(msg.ID);
			try {
				return extractPasswordResetToken(fullMessage.Text);
			} catch {
				// Continue to next email
			}
		}

		if (attempt < cfg.maxRetries) {
			await sleep(delay);
			totalWaitTime += delay;
			delay = Math.min(delay * cfg.backoffMultiplier, cfg.maxDelayMs);
		}
	}

	throw new Error(
		`No password reset token email received for ${toEmail} after ${
			cfg.maxRetries
		} attempts (waited ~${Math.round(totalWaitTime / 1000)}s)`
	);
}

/**
 * Extracts the email verification token from an email body.
 * The token is a region-prefixed token in the format: REGION-{64-char-hex}
 * Example: IND1-abc123def456...
 *
 * @param emailText - Plain text email body
 * @returns The region-prefixed verification token
 * @throws Error if no verification token is found
 */
export function extractEmailVerificationToken(emailText: string): string {
	// Look for region-prefixed token pattern: (IND1|USA1|DEU1)-{64-char hex}
	const match = emailText.match(/\b(IND1|USA1|DEU1)-([a-f0-9]{64})\b/);
	if (!match) {
		throw new Error(
			`No email verification token found in email: ${emailText.substring(0, 200)}...`
		);
	}
	return match[0]; // Return full match including region prefix
}

/**
 * Waits for and extracts the email verification token from email.
 *
 * @param toEmail - Email address to wait for
 * @param config - Optional configuration for retry behavior
 * @returns The region-prefixed email verification token
 */
export async function getEmailVerificationTokenFromEmail(
	toEmail: string,
	config: Partial<WaitForEmailConfig> = {}
): Promise<string> {
	const cfg = { ...DEFAULT_WAIT_CONFIG, ...config };

	let delay = cfg.initialDelayMs;
	let totalWaitTime = 0;

	for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
		const messages = await searchEmails(toEmail);

		// Search through emails to find one with an email verification token
		for (const msg of messages) {
			const fullMessage = await getEmailContent(msg.ID);
			try {
				return extractEmailVerificationToken(fullMessage.Text);
			} catch {
				// Continue to next email
			}
		}

		if (attempt < cfg.maxRetries) {
			await sleep(delay);
			totalWaitTime += delay;
			delay = Math.min(delay * cfg.backoffMultiplier, cfg.maxDelayMs);
		}
	}

	throw new Error(
		`No email verification token email received for ${toEmail} after ${
			cfg.maxRetries
		} attempts (waited ~${Math.round(totalWaitTime / 1000)}s)`
	);
}

// Helper function for async sleep
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
