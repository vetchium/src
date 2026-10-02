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
  type HubRegionSettings,
  parseHubRegionSettings,
} from "./hub-region-settings";
import ciHub from "./regions/ci.json";
import devHub from "./regions/dev.json";
import productionHub from "./regions/production.json";

const environment: PortalEnvironment = parsePortalEnvironment(
  import.meta.env.VITE_VETCHIUM_ENVIRONMENT,
);

// Each comparison is a literal once Vite substitutes the environment, so the
// bundler drops the other environments' tables from the build.
const tables =
  import.meta.env.VITE_VETCHIUM_ENVIRONMENT === "production"
    ? { regions: productionRegions, hub: productionHub }
    : import.meta.env.VITE_VETCHIUM_ENVIRONMENT === "ci"
      ? { regions: ciRegions, hub: ciHub }
      : { regions: devRegions, hub: devHub };

export const regionTable = parseRegionTable(tables.regions, environment);

export const regionStore = createRegionStore({
  key: "vetchium.hub.region",
  table: regionTable,
});

const hubSettings = parseHubRegionSettings(
  tables.hub,
  regionTable.regions.map((region) => region.tenantId),
);

export function hubRegionSettings(tenantId: string): HubRegionSettings {
  const settings = hubSettings.get(tenantId);
  if (settings === undefined) throw new Error(`unknown region ${tenantId}`);
  return settings;
}
