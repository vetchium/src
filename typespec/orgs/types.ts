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
