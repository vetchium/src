export type WebsiteKind = "github" | "gitlab" | "linkedin" | "x" | "website";

const knownHosts = new Map<string, Exclude<WebsiteKind, "website">>([
  ["github.com", "github"],
  ["gitlab.com", "gitlab"],
  ["linkedin.com", "linkedin"],
  ["x.com", "x"],
  ["twitter.com", "x"],
]);

/**
 * PROF-WEB-006: presentation only. The kind comes from the host alone, is
 * never sent or stored, and does not show that the user owns the profile.
 * `host` is the display name for a generic website.
 */
export function describeWebsite(url: string): {
  kind: WebsiteKind;
  host: string;
} {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = url;
  }
  // A parsed URL without a host (such as a `javascript:` value from a peer)
  // falls back to the raw text so the entry is never blank.
  const host = (hostname || url).replace(/^www\./, "");
  return { kind: knownHosts.get(host) ?? "website", host };
}
