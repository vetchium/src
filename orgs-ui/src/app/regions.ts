import { createRegionStore } from "@vetchium/portal-ui/region-selection";
import {
  type PortalEnvironment,
  parsePortalEnvironment,
  parseRegionTable,
} from "@vetchium/portal-ui/regions";
import ciRegions from "@vetchium/portal-ui/regions/ci.json";
import devRegions from "@vetchium/portal-ui/regions/dev.json";
import productionRegions from "@vetchium/portal-ui/regions/production.json";
import {
  type OrgRegionSettings,
  parseOrgRegionSettings,
} from "./org-region-settings";
import ciOrg from "./regions/ci.json";
import devOrg from "./regions/dev.json";
import productionOrg from "./regions/production.json";

const environment: PortalEnvironment = parsePortalEnvironment(
  import.meta.env.VITE_VETCHIUM_ENVIRONMENT,
);

// Each comparison is a literal once Vite substitutes the environment, so the
// bundler drops the other environments' tables from the build.
const tables =
  import.meta.env.VITE_VETCHIUM_ENVIRONMENT === "production"
    ? { regions: productionRegions, org: productionOrg }
    : import.meta.env.VITE_VETCHIUM_ENVIRONMENT === "ci"
      ? { regions: ciRegions, org: ciOrg }
      : { regions: devRegions, org: devOrg };

export const regionTable = parseRegionTable(tables.regions, environment);

const orgSettings = parseOrgRegionSettings(
  tables.org,
  regionTable.regions.map((region) => region.tenantId),
);

export function orgRegionSettings(tenantId: string): OrgRegionSettings {
  const settings = orgSettings.get(tenantId);
  if (settings === undefined) throw new Error(`unknown region ${tenantId}`);
  return settings;
}

export const regionStore = createRegionStore({
  key: "vetchium.orgs.region",
  table: regionTable,
});
