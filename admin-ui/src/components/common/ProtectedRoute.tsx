import { ProtectedRoute as SharedProtectedRoute } from "@vetchium/portal-ui/shell";
import { useAuth } from "../../auth/AuthContext";
import { useMyInfoQuery } from "../../features/profile/queries";

export function ProtectedRoute() {
  const { authenticated } = useAuth();
  return (
    <SharedProtectedRoute
      authenticated={authenticated}
      identity={useMyInfoQuery(authenticated)}
    />
  );
}
