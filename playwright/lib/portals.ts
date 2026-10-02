import type { BrowserContext } from "@playwright/test";
import type { TestTenant } from "./admin-db.ts";

// One global Hub and Orgs portal serve every region; each region's API lives
// on its own host. See agent-guides/ui.md.
export const HUB_PORTAL = "http://vetchium.localhost";
export const ORGS_PORTAL = "http://orgs.vetchium.localhost";

export function apiOrigin(tenant: TestTenant): string {
  return `http://${tenant}.api.vetchium.localhost`;
}

// Regional preferences used by signup and password recovery.
const regionKeys = {
  hub: "vetchium.hub.region",
  orgs: "vetchium.orgs.region",
} as const;

/**
 * Starts every page in `context` with `tenant` remembered as the portal's
 * preference. Sign-in ignores this preference and requires a choice on the page.
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
