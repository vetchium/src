import { useQuery } from "@tanstack/react-query";
import type { MyInfoResponse } from "typespec/orgs/account/account";
import { orgsAPI } from "../../api/orgs";

export const myInfoQueryKey = ["orgs", "my-info"] as const;

export function useMyInfoQuery(enabled = true) {
  return useQuery<MyInfoResponse>({
    queryKey: myInfoQueryKey,
    queryFn: orgsAPI.myInfo,
    retry: false,
    enabled,
  });
}
