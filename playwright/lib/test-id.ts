import { randomUUID } from "node:crypto";

/** Return a unique, log-friendly identifier for test-owned data. */
export function uniqueTestID(prefix: string): string {
  const safePrefix = prefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `${safePrefix || "test"}-${randomUUID()}`;
}

/** Return an address that is unique across workers and repeated runs. */
export function uniqueTestEmail(prefix: string): string {
  return `${uniqueTestID(prefix)}@tests.example`;
}
