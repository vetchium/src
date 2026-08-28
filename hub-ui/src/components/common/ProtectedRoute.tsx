import { Alert, Button, Flex, Spin } from "antd";
import { useTranslation } from "react-i18next";
import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../../auth/AuthContext";
import { useMyInfoQuery } from "../../features/profile/queries";

export function ProtectedRoute() {
  const { t } = useTranslation();
  const { authenticated } = useAuth();
  const location = useLocation();
  const myInfo = useMyInfoQuery(authenticated);

  if (!authenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={
          returnTo === "/"
            ? "/login"
            : `/login?returnTo=${encodeURIComponent(returnTo)}`
        }
        replace
      />
    );
  }
  if (myInfo.isPending) return <Spin fullscreen size="large" />;
  if (myInfo.isError) {
    return (
      <Flex className="route-error" vertical gap="middle">
        <Alert type="error" title={t("common.loadError")} />
        <Button onClick={() => void myInfo.refetch()}>
          {t("common.retry")}
        </Button>
      </Flex>
    );
  }
  return <Outlet />;
}
