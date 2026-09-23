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

export function usePublicProfileQuery(address: string, enabled = true) {
  return useQuery({
    queryKey: ["hub", "profile", address],
    queryFn: () => hubAPI.readProfile({ address }),
    retry: false,
    enabled,
  });
}

export const professionalEmailsQueryKey = [
  "hub",
  "professional-emails",
] as const;

export function useProfessionalEmailsQuery() {
  return useQuery({
    queryKey: professionalEmailsQueryKey,
    queryFn: () => hubAPI.listProfessionalEmails({ limit: 10 }),
    retry: false,
  });
}

export const aliasStateQueryKey = ["hub", "profile", "alias-state"] as const;

export function useAliasStateQuery(enabled: boolean) {
  return useQuery({
    queryKey: aliasStateQueryKey,
    queryFn: hubAPI.aliasState,
    retry: false,
    enabled,
  });
}
