import { createRegionStore } from "@vetchium/portal-ui/region-selection";
import {
  type PortalEnvironment,
  parsePortalEnvironment,
  parseRegionTable,
} from "@vetchium/portal-ui/regions";
import ciRegions from "@vetchium/portal-ui/regions/ci.json";
import devRegions from "@vetchium/portal-ui/regions/dev.json";
import productionRegions from "@vetchium/portal-ui/regions/production.json";

const environment: PortalEnvironment = parsePortalEnvironment(
  import.meta.env.VITE_VETCHIUM_ENVIRONMENT,
);

// Each comparison is a literal once Vite substitutes the environment, so the
// bundler drops the other environments' tables from the build.
const regions =
  import.meta.env.VITE_VETCHIUM_ENVIRONMENT === "production"
    ? productionRegions
    : import.meta.env.VITE_VETCHIUM_ENVIRONMENT === "ci"
      ? ciRegions
      : devRegions;

export const regionTable = parseRegionTable(regions, environment);

export const regionStore = createRegionStore({
  key: "vetchium.orgs.region",
  table: regionTable,
});
