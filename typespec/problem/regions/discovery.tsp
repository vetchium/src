import "../details.tsp";

namespace Vetchium.Problem;

const RegionDiscoveryUnavailableError = #{
  type: "vetchium-problem-details/region-discovery-unavailable",
  title: "Region discovery unavailable",
  status: 503,
  detail: "Region discovery is temporarily unavailable. Start again from the first page.",
};
alias RegionDiscoveryUnavailableErrorResponse = Response<
  503,
  typeof RegionDiscoveryUnavailableError
>;
