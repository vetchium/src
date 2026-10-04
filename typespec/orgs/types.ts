import {
  isProfessionalDomain,
  normalizeProfessionalDomain,
} from "../common/domain.ts";

export const frontendLocaleValues = ["en-US", "ta", "de-DE"] as const;

export type FrontendLocale = (typeof frontendLocaleValues)[number];

const frontendLocales = new Set<string>(frontendLocaleValues);

export function isFrontendLocale(value: unknown): value is FrontendLocale {
  return typeof value === "string" && frontendLocales.has(value);
}

export type OrgDID = string;
export type OrgDomain = string;

export function normalizeOrgDomain(value: OrgDomain): OrgDomain {
  return normalizeProfessionalDomain(value);
}

/** Accepts a value only in its normalized form. */
export function isOrgDomain(value: OrgDomain): boolean {
  if (normalizeOrgDomain(value) !== value || !isProfessionalDomain(value)) {
    return false;
  }
  return /[a-z]/.test(value.slice(value.lastIndexOf(".") + 1));
}

/** Names reserved for testing, documentation, and local networks (RFC 2606,
 * RFC 6761, RFC 6762, RFC 7686, RFC 8375, RFC 9476, and ICANN's internal).
 * Nobody can publish a public DNS record under them. */
const specialUseDomains = [
  "alt",
  "example",
  "example.com",
  "example.net",
  "example.org",
  "home.arpa",
  "internal",
  "invalid",
  "local",
  "localhost",
  "onion",
  "test",
];

/** Whether a normalized Org domain is, or is under, a special-use name.
 * Whether such a domain may sign up is tenant policy, so this is not part of
 * isOrgDomain. */
export function isSpecialUseDomain(value: OrgDomain): boolean {
  return specialUseDomains.some(
    (reserved) => value === reserved || value.endsWith(`.${reserved}`),
  );
}
