import { App, Drawer, Flex, Grid, Layout, Menu, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigate } from "react-router";
import { usePendingOperations } from "../../app/PendingOperationContext";
import { usePreferences } from "../../app/PreferencesContext";
import { useAuth } from "../../auth/AuthContext";
import { useMyInfoQuery } from "../../features/profile/queries";
import { AppHeader } from "./AppHeader";

const { Content, Footer, Sider } = Layout;

export function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const screens = Grid.useBreakpoint();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const auth = useAuth();
  const preferences = usePreferences();
  const { message } = App.useApp();
  const { pending } = usePendingOperations();
  const { data: me } = useMyInfoQuery();
  useEffect(() => {
    if (me !== undefined && me.preferred_language !== preferences.language) {
      preferences.setLanguage(me.preferred_language);
    }
  }, [me, preferences]);
  const canViewUsers =
    me?.is_superadmin === true ||
    me?.permissions.includes("admin:view_users") === true;
  const selectedKey = location.pathname.startsWith("/users")
    ? "/users"
    : location.pathname.startsWith("/settings/profile")
      ? "/settings/profile"
      : location.pathname.startsWith("/settings/security")
        ? "/settings/security"
        : "/";
  const navigationItems = [
    { key: "/", label: t("navigation.overview") },
    ...(canViewUsers ? [{ key: "/users", label: t("navigation.users") }] : []),
    { key: "/settings/profile", label: t("navigation.profile") },
    { key: "/settings/security", label: t("navigation.security") },
  ];

  const heldBack = () => {
    if (!pending) {
      return false;
    }
    void message.warning(t("shell.operationInProgress"));
    return true;
  };

  const navigateFromMenu = (path: string) => {
    if (heldBack()) {
      return;
    }
    setNavigationOpen(false);
    navigate(path);
  };

  const signOut = async () => {
    if (heldBack()) {
      return;
    }
    await auth.logout();
    navigate("/login", { replace: true });
  };

  return (
    <Layout className="app-layout">
      <title>{t("shell.documentTitle")}</title>
      <AppHeader
        homePath="/"
        onNavigateHome={() => navigateFromMenu("/")}
        onOpenNavigation={() => setNavigationOpen(true)}
        onSignOut={() => void signOut()}
      />
      <Drawer
        title={t("navigation.menu")}
        placement="left"
        size={280}
        open={screens.lg !== true && navigationOpen}
        styles={{ body: { padding: 0 } }}
        onClose={() => setNavigationOpen(false)}
      >
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={navigationItems}
          onClick={({ key }) => navigateFromMenu(key)}
        />
      </Drawer>
      <Layout>
        {screens.lg === true ? (
          <Sider theme={preferences.themeMode}>
            <Menu
              mode="inline"
              selectedKeys={[selectedKey]}
              items={navigationItems}
              onClick={({ key }) => navigateFromMenu(key)}
            />
          </Sider>
        ) : null}
        <Flex
          component={Content}
          className="app-content"
          orientation="vertical"
        >
          <Outlet />
        </Flex>
      </Layout>
      <Footer>
        <Flex justify="center">
          <Typography.Text type="secondary">
            {t("shell.footer")}
          </Typography.Text>
        </Flex>
      </Footer>
    </Layout>
  );
}
