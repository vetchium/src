import type { AdminSessionToken } from "../../../typespec/admin/auth/types.ts";

const sessionTokenKey = "vetchium.admin.session-token";

export function getSessionToken(): AdminSessionToken | null {
  return window.sessionStorage.getItem(sessionTokenKey);
}

export function setSessionToken(token: AdminSessionToken): void {
  window.sessionStorage.setItem(sessionTokenKey, token);
}

export function clearSessionToken(): void {
  window.sessionStorage.removeItem(sessionTokenKey);
}
