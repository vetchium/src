import { useQuery } from "@tanstack/react-query";
import { getMyInfo } from "./api";

export type MyInfoQueryData = Awaited<ReturnType<typeof getMyInfo>>;

export const myInfoQueryKey = ["admin", "my-info"] as const;

export function useMyInfoQuery(enabled = true) {
  return useQuery({
    queryKey: myInfoQueryKey,
    queryFn: getMyInfo,
    retry: false,
    enabled,
  });
}
