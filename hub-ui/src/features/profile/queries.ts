import { useQuery } from "@tanstack/react-query";
import { hubAPI } from "../../api/hub";

export type MyInfoQueryData = Awaited<ReturnType<typeof hubAPI.myInfo>>;

export const myInfoQueryKey = ["hub", "my-info"] as const;

export function useMyInfoQuery(enabled = true) {
  return useQuery({
    queryKey: myInfoQueryKey,
    queryFn: hubAPI.myInfo,
    retry: false,
    enabled,
  });
}
