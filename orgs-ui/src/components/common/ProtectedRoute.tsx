import { ProtectedRoute as SharedProtectedRoute } from "@vetchium/portal-ui/shell";
import { Navigate, Outlet } from "react-router";
import { OrgSuspended } from "typespec/orgs/account/account";
import { paths } from "../../app/paths";
import { useAuth } from "../../auth/AuthContext";
import { useMyInfoQuery } from "../../features/account/queries";

export function ProtectedRoute() {
  const { authenticated } = useAuth();
  return (
    <SharedProtectedRoute
      authenticated={authenticated}
      identity={useMyInfoQuery(authenticated)}
      omitRootReturnTo
    />
  );
}

/** A suspended Org may only restore its domain, manage credentials, and sign
 * out, so every other signed-in screen sends it to the restore screen. */
export function ActiveOrgRoute() {
  const { data: me } = useMyInfoQuery();
  if (me?.org.org_state === OrgSuspended) {
    return <Navigate replace to={paths.restoreDomain} />;
  }
  return <Outlet />;
}
