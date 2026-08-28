import { Spin } from "antd";
import { Navigate, Outlet, useLocation } from "react-router";
import { useMyInfoQuery } from "../../features/profile/queries";

const MAXIMUM_AGE_MS = 4 * 60 * 1000;

export function RecentAuthenticationRoute() {
  const { data: me } = useMyInfoQuery();
  const location = useLocation();
  if (me === undefined) return <Spin fullscreen size="large" />;
  const authenticatedAt = Date.parse(me.session_authenticated_at);
  if (
    !Number.isFinite(authenticatedAt) ||
    Date.now() - authenticatedAt >= MAXIMUM_AGE_MS
  ) {
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
