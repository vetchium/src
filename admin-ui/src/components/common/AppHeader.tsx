import { MenuOutlined } from "@ant-design/icons";
import {
  Avatar,
  Button,
  Flex,
  Grid,
  Layout,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { HeaderControls } from "./HeaderControls";

const { Header } = Layout;

interface AppHeaderProps {
  homePath: string;
  onOpenNavigation?: () => void;
  onSignOut?: () => void;
}

export function AppHeader({
  homePath,
  onOpenNavigation,
  onSignOut,
}: AppHeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const { token } = theme.useToken();
  const compactBrand = screens.sm !== true;
  const mobileNavigation =
    screens.lg !== true && onOpenNavigation !== undefined;

  return (
    <Header
      style={{
        height: 64,
        paddingInline: compactBrand ? 12 : 24,
        lineHeight: "normal",
        background: token.colorBgContainer,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Flex
        align="center"
        justify="space-between"
        gap="small"
        wrap={false}
        style={{
          width: "100%",
          maxWidth: 1440,
          height: "100%",
          margin: "0 auto",
        }}
      >
        <Flex align="center" gap={4} wrap={false}>
          {mobileNavigation ? (
            <Tooltip title={t("navigation.openMenu")}>
              <Button
                type="text"
                shape="circle"
                icon={<MenuOutlined />}
                aria-label={t("navigation.openMenu")}
                onClick={onOpenNavigation}
              />
            </Tooltip>
          ) : null}
          <Button
            type="text"
            size="large"
            aria-label={t("shell.homeLabel")}
            style={{ height: 48, paddingInline: compactBrand ? 4 : 8 }}
            onClick={() => navigate(homePath)}
          >
            <Flex align="center" gap="small" wrap={false}>
              <Avatar
                shape="square"
                size={32}
                style={{
                  background: token.colorPrimary,
                  color: token.colorTextLightSolid,
                  fontWeight: token.fontWeightStrong,
                }}
              >
                {t("shell.monogram")}
              </Avatar>
              {compactBrand ? null : (
                <>
                  <Typography.Text
                    strong
                    style={{ fontSize: token.fontSizeLG }}
                  >
                    {t("shell.brand")}
                  </Typography.Text>
                  <Tag
                    color={token.colorPrimary}
                    variant="filled"
                    style={{ marginInlineEnd: 0 }}
                  >
                    {t("shell.portal")}
                  </Tag>
                </>
              )}
            </Flex>
          </Button>
        </Flex>
        <HeaderControls onSignOut={onSignOut} />
      </Flex>
    </Header>
  );
}
