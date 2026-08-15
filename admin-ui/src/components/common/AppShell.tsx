import { Button, Flex, Layout, Menu, Typography } from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigate } from "react-router";
import { usePreferences } from "../../app/PreferencesContext";
import { useAuth } from "../../auth/AuthContext";
import { useMyInfoQuery } from "../../features/profile/queries";
import { HeaderControls } from "./HeaderControls";

const { Header, Content, Footer, Sider } = Layout;

export function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const preferences = usePreferences();
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
      : "/";

  const signOut = async () => {
    await auth.logout();
    navigate("/login", { replace: true });
  };

  return (
    <Layout className="app-layout">
      <title>{t("shell.documentTitle")}</title>
      <Header>
        <Flex
          className="app-header-content"
          align="center"
          justify="space-between"
        >
          <Button
            shape="round"
            size="large"
            ghost
            aria-label={t("shell.homeLabel")}
            onClick={() => navigate("/")}
          >
            {t("shell.logo")}
          </Button>
          <Flex gap="small" align="center">
            <HeaderControls />
            <Button ghost onClick={() => void signOut()}>
              {t("shell.logout")}
            </Button>
          </Flex>
        </Flex>
      </Header>
      <Layout>
        <Sider breakpoint="lg" collapsedWidth="0" theme={preferences.themeMode}>
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            items={[
              { key: "/", label: t("navigation.overview") },
              ...(canViewUsers
                ? [{ key: "/users", label: t("navigation.users") }]
                : []),
              { key: "/settings/profile", label: t("navigation.profile") },
            ]}
            onClick={({ key }) => navigate(key)}
          />
        </Sider>
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
