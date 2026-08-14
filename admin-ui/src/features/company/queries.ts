import { useQuery } from "@tanstack/react-query";
import { getCompanyRegionalDefaults } from "./api";

export function useCompanyRegionalDefaultsQuery() {
  return useQuery({
    queryKey: ["admin", "company-regional-defaults"],
    queryFn: getCompanyRegionalDefaults,
    staleTime: 300_000,
  });
}
