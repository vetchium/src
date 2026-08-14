import { Button, Flex, Layout, Menu, Space, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../../auth/AuthContext";
import { useMyInfoQuery } from "../../features/profile/queries";

const { Header, Content, Footer, Sider } = Layout;

export function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const { data: me } = useMyInfoQuery();
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
          <Link className="brand-link" to="/" aria-label={t("shell.homeLabel")}>
            <Space>
              <span>{t("shell.brand")}</span>
              <Tag variant="filled" color="green">
                {t("shell.portal")}
              </Tag>
            </Space>
          </Link>
          <Button
            type="text"
            className="header-action"
            onClick={() => void signOut()}
          >
            {t("shell.logout")}
          </Button>
        </Flex>
      </Header>
      <Layout>
        <Sider breakpoint="lg" collapsedWidth="0" theme="light">
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
