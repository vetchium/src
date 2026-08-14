import { Flex, Layout, Space, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, Outlet } from "react-router";

const { Header, Content, Footer } = Layout;

export function PublicShell() {
  const { t } = useTranslation();
  return (
    <Layout className="app-layout">
      <title>{t("shell.documentTitle")}</title>
      <Header>
        <Flex className="app-header-content" align="center">
          <Link
            className="brand-link"
            to="/login"
            aria-label={t("shell.homeLabel")}
          >
            <Space>
              <span>{t("shell.brand")}</span>
              <Tag variant="filled" color="green">
                {t("shell.portal")}
              </Tag>
            </Space>
          </Link>
        </Flex>
      </Header>
      <Flex
        component={Content}
        className="public-content"
        align="center"
        justify="center"
      >
        <Outlet />
      </Flex>
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
