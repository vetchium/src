import type { Details } from "../details.ts";

export const RegionDiscoveryUnavailableError: Readonly<Details> = {
  type: "vetchium-problem-details/region-discovery-unavailable",
  title: "Region discovery unavailable",
  status: 503,
  detail:
    "Region discovery is temporarily unavailable. Start again from the first page.",
};
