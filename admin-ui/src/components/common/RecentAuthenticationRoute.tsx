import { RecentAuthenticationRoute as SharedRecentAuthenticationRoute } from "@vetchium/portal-ui/shell";
import { useMyInfoQuery } from "../../features/profile/queries";

export function RecentAuthenticationRoute() {
  const { data: me } = useMyInfoQuery();
  return (
    <SharedRecentAuthenticationRoute
      authenticatedAt={me?.session_authenticated_at}
    />
  );
}
