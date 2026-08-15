import { Spin } from "antd";
import { Navigate, Outlet, useLocation } from "react-router";
import { useMyInfoQuery } from "../../features/profile/queries";

// Keep one minute of the backend's five-minute freshness window in reserve.
const SECURITY_PAGE_AUTHENTICATION_MAXIMUM_AGE_MS = 4 * 60 * 1000;

function authenticationIsRecent(authenticatedAt: string): boolean {
  const authenticatedAtMilliseconds = Date.parse(authenticatedAt);
  return (
    Number.isFinite(authenticatedAtMilliseconds) &&
    Date.now() - authenticatedAtMilliseconds <
      SECURITY_PAGE_AUTHENTICATION_MAXIMUM_AGE_MS
  );
}

export function RecentAuthenticationRoute() {
  const { data: me } = useMyInfoQuery();
  const location = useLocation();

  if (me === undefined) {
    return <Spin fullscreen size="large" />;
  }
  if (!authenticationIsRecent(me.session_authenticated_at)) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        replace
        to={`/reauthenticate?returnTo=${encodeURIComponent(returnTo)}`}
      />
    );
  }

  return <Outlet />;
}
