import { useQuery } from "@tanstack/react-query";
import { getMyInfo } from "./api";

export const myInfoQueryKey = ["admin", "my-info"] as const;

export function useMyInfoQuery(enabled = true) {
  return useQuery({
    queryKey: myInfoQueryKey,
    queryFn: getMyInfo,
    retry: false,
    enabled,
  });
}
