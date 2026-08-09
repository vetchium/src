/** An email address accepted by Vetchium APIs. */
export type EmailAddress = string;

/** A non-empty password. Passwords are never returned by an API. */
export type Password = string;

export function normalizeEmailAddress(value: EmailAddress): EmailAddress {
  return value.trim().toLowerCase();
}

export function isEmailAddress(value: EmailAddress): boolean {
  const normalized = normalizeEmailAddress(value);
  if (normalized.length > 254 || normalized.split("@").length !== 2) {
    return false;
  }
  const [local = "", domain = ""] = normalized.split("@");
  if (
    local.length < 1 ||
    local.length > 64 ||
    domain.length < 1 ||
    domain.length > 253 ||
    !/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..")
  ) {
    return false;
  }
  return domain
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
