import type { OrgDomain } from "typespec/orgs/types";
import { uniqueTestID } from "./test-id.ts";

/**
 * The development PowerDNS server is authoritative for these reserved zones
 * only, and every tenant resolves Org verification records through it. A
 * domain outside them gets REFUSED, which the backend treats as inconclusive.
 * Seeded Orgs live under example.com; tests use unique names under example,
 * or under test where a test needs that zone.
 */
export const DEV_DNS_ZONES = ["example.com", "example", "test"] as const;

type TestZone = Exclude<(typeof DEV_DNS_ZONES)[number], "example.com">;

function zoneOf(domain: OrgDomain): string {
  const zone = DEV_DNS_ZONES.find((candidate) =>
    domain.endsWith(`.${candidate}`),
  );
  if (!zone) {
    throw new Error(`${domain} is outside the development DNS zones`);
  }
  return zone;
}

export const DEV_DNS_ORIGIN =
  process.env.DNS_DEV_API_URL ?? "http://127.0.0.1:18081";

// Fixed in docker-compose.json and docker-compose-ci.json; it guards a
// loopback-only development server, not production data.
const DEV_DNS_API_KEY = "vetchium-dev-dns-api-key";

/** Return a domain under a development zone that no other test uses. */
export function uniqueOrgDomain(zone: TestZone = "example"): OrgDomain {
  return `${uniqueTestID("org")}.${zone}`;
}

/**
 * Replace every TXT record at `_vetchium.<domain>` with one record per value.
 * The request goes straight to PowerDNS rather than through the Playwright
 * request fixture, whose API-coverage tracking would report PowerDNS's own
 * `/api/v1` paths as undocumented Vetchium API behavior.
 */
export async function setOrgVerificationRecord(
  domain: OrgDomain,
  values: string[],
): Promise<void> {
  await patchVerificationRRSet(domain, {
    changetype: "REPLACE",
    ttl: 60,
    records: values.map((value) => ({
      content: txtContent(value),
      disabled: false,
    })),
  });
}

/** Delete every TXT record at `_vetchium.<domain>`; absent records are fine. */
export async function deleteOrgVerificationRecord(
  domain: OrgDomain,
): Promise<void> {
  await patchVerificationRRSet(domain, { changetype: "DELETE" });
}

interface RRSetChange {
  changetype: "REPLACE" | "DELETE";
  ttl?: number;
  records?: { content: string; disabled: boolean }[];
}

async function patchVerificationRRSet(
  domain: OrgDomain,
  change: RRSetChange,
): Promise<void> {
  const response = await fetch(
    `${DEV_DNS_ORIGIN}/api/v1/servers/localhost/zones/${zoneOf(domain)}.`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": DEV_DNS_API_KEY,
      },
      body: JSON.stringify({
        rrsets: [{ name: `_vetchium.${domain}.`, type: "TXT", ...change }],
      }),
    },
  );
  if (response.status !== 204) {
    throw new Error(
      `development DNS ${change.changetype} for ${domain} returned ${response.status}: ${await response.text()}`,
    );
  }
}

/**
 * PowerDNS takes TXT content in zone-file presentation form. Its API rejects
 * an escaped quote inside a character-string, so values are limited to
 * printable ASCII without quotes or backslashes, which covers every
 * verification value.
 */
function txtContent(value: string): string {
  if (/["\\]|[^ -~]/.test(value)) {
    throw new Error(
      `unsupported development TXT value ${JSON.stringify(value)}`,
    );
  }
  return `"${value}"`;
}
