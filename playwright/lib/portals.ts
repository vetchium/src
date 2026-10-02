import type { BrowserContext } from "@playwright/test";
import type { TestTenant } from "./admin-db.ts";

// One global Hub and Orgs portal serve every region; each region's API lives
// on its own host. See agent-guides/ui.md.
export const HUB_PORTAL = "http://vetchium.localhost";
export const ORGS_PORTAL = "http://orgs.vetchium.localhost";

export function apiOrigin(tenant: TestTenant): string {
  return `http://${tenant}.api.vetchium.localhost`;
}

// The storage keys the portals remember the sign-in region under.
const regionKeys = {
  hub: "vetchium.hub.region",
  orgs: "vetchium.orgs.region",
} as const;

/**
 * Starts every page in `context` with `tenant` remembered as the portal's
 * sign-in region, as a returning visitor would have it. Tests of the region
 * picker itself choose the region on the page instead.
 */
export async function rememberRegion(
  context: BrowserContext,
  portal: keyof typeof regionKeys,
  tenant: TestTenant,
): Promise<void> {
  await context.addInitScript(
    ([key, value]) => {
      if (globalThis.localStorage.getItem(key) === null) {
        globalThis.localStorage.setItem(key, value);
      }
    },
    [regionKeys[portal], tenant] as const,
  );
}

/**
 * Reads the token, and checks the region, of an emailed portal link such as
 * `<portal>/reset-password?region=sgp&token=...`.
 */
export function emailedLinkToken(
  body: string,
  path: string,
  tenant: TestTenant,
): string | undefined {
  const match = body.match(
    new RegExp(`${path}\\?region=([a-z0-9-]+)&token=([0-9a-f]{64})`),
  );
  return match?.[1] === tenant ? match[2] : undefined;
}
