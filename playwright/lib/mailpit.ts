/**
 * Mailpit API client for retrieving TFA codes from emails.
 *
 * Mailpit API docs: https://mailpit.axllent.org/docs/api-v1/
 * Running at: http://localhost:8025
 */

const MAILPIT_API_URL = "http://localhost:8025/api/v1";

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
export async function searchEmails(toEmail: string): Promise<MailpitMessageSummary[]> {
  const query = encodeURIComponent(`to:${toEmail}`);
  const response = await fetch(`${MAILPIT_API_URL}/search?query=${query}`);

  if (!response.ok) {
    throw new Error(`Mailpit search failed: ${response.status} ${response.statusText}`);
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
export async function getEmailContent(messageId: string): Promise<MailpitMessage> {
  const response = await fetch(`${MAILPIT_API_URL}/message/${messageId}`);

  if (!response.ok) {
    throw new Error(`Mailpit get message failed: ${response.status} ${response.statusText}`);
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
    throw new Error(`No TFA code found in email: ${emailText.substring(0, 200)}...`);
  }
  return match[1];
}

/**
 * Waits for an email to arrive for the specified recipient.
 * Polls mailpit until an email is found or timeout is reached.
 *
 * @param toEmail - Email address to wait for
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 10000)
 * @param pollIntervalMs - Interval between polls in milliseconds (default: 500)
 * @returns The first matching message summary
 * @throws Error if no email arrives within timeout
 */
export async function waitForEmail(
  toEmail: string,
  timeoutMs: number = 10000,
  pollIntervalMs: number = 500
): Promise<MailpitMessageSummary> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const messages = await searchEmails(toEmail);
    if (messages.length > 0) {
      // Return the most recent message (first in the list)
      return messages[0];
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(`No email received for ${toEmail} within ${timeoutMs}ms`);
}

/**
 * Gets the TFA code from the most recent email sent to the specified address.
 * This is a convenience function that combines waiting for email and extracting the code.
 *
 * @param toEmail - Email address to get TFA code for
 * @param timeoutMs - Maximum time to wait for email
 * @returns The 6-digit TFA code
 */
export async function getTfaCodeFromEmail(
  toEmail: string,
  timeoutMs: number = 10000
): Promise<string> {
  const message = await waitForEmail(toEmail, timeoutMs);
  const fullMessage = await getEmailContent(message.ID);
  return extractTfaCode(fullMessage.Text);
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
    throw new Error(`Mailpit delete all failed: ${response.status} ${response.statusText}`);
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

// Helper function for async sleep
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
