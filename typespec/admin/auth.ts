import type { EmailAddress, Password } from "../common/common";
import type { State } from "./user/user";

/** Credentials submitted to create an admin session. */
export interface LoginRequest {
  /** Lowercased after surrounding whitespace is removed. */
  email_address: EmailAddress;

  /** Must be non-empty. */
  password: Password;
}

/** Return a normalized copy without modifying the caller's request. */
export function normalizeLoginRequest(request: LoginRequest): LoginRequest {
  return {
    ...request,
    email_address: request.email_address.trim().toLowerCase(),
  };
}

/** Return JSON member names that do not satisfy the contract. */
export function validateLoginRequest(request: LoginRequest): string[] {
  const normalized = normalizeLoginRequest(request);
  const invalidFields: string[] = [];

  if (!isEmailAddress(normalized.email_address)) {
    invalidFields.push("email_address");
  }
  if (normalized.password.length === 0) {
    invalidFields.push("password");
  }

  return invalidFields;
}

function isEmailAddress(value: string): boolean {
  if (/\s/.test(value)) {
    return false;
  }

  const separator = value.indexOf("@");
  return (
    separator > 0 &&
    separator === value.lastIndexOf("@") &&
    separator < value.length - 1
  );
}

/** A newly created admin session. */
export interface LoginResponse {
  session_token: string;

  /** An RFC 3339 timestamp. */
  expires_at: string;
}

/** Information about the authenticated admin and current session. */
export interface MyInfoResponse {
  admin_user_id: string;
  email_address: EmailAddress;
  display_name: string;
  admin_user_state: State;

  /** An RFC 3339 timestamp. */
  last_login_at?: string;

  /** An RFC 3339 timestamp. */
  created_at: string;

  /** An RFC 3339 timestamp. */
  session_expires_at: string;
  tenant_id: string;
}
