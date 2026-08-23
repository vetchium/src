import {
  GlobalOutlined,
  LogoutOutlined,
  MoonOutlined,
  SunOutlined,
} from "@ant-design/icons";
import { Button, Flex, Grid, Select, Switch, Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import {
  type FrontendLocale,
  isFrontendLocale,
} from "../../../../typespec/common/localization.ts";
import { usePreferences } from "../../app/PreferencesContext";

const languages: FrontendLocale[] = ["en-US", "ta", "de_DE"];

interface HeaderControlsProps {
  onSignOut?: () => void;
}

export function HeaderControls({ onSignOut }: HeaderControlsProps) {
  const { t } = useTranslation();
  const screens = Grid.useBreakpoint();
  const preferences = usePreferences();
  const compact = screens.sm !== true;

  return (
    <Flex gap="small" align="center" wrap={false}>
      <Select<FrontendLocale>
        value={preferences.language}
        aria-label={t("language.selectorLabel")}
        prefix={<GlobalOutlined />}
        placement="bottomRight"
        popupMatchSelectWidth={false}
        style={{ width: compact ? 88 : 160 }}
        options={languages.map((language) => ({
          value: language,
          label: t(`languages.${language}`),
        }))}
        labelRender={({ value }) =>
          t(
            compact
              ? `languageShort.${value as FrontendLocale}`
              : `languages.${value as FrontendLocale}`,
          )
        }
        onChange={(language) => {
          if (isFrontendLocale(language)) preferences.setLanguage(language);
        }}
      />
      <Tooltip title={t("theme.toggleLabel")}>
        <Switch
          checked={preferences.themeMode === "dark"}
          checkedChildren={<MoonOutlined />}
          unCheckedChildren={<SunOutlined />}
          aria-label={t("theme.toggleLabel")}
          onChange={preferences.toggleTheme}
        />
      </Tooltip>
      {onSignOut === undefined ? null : (
        <Tooltip title={t("shell.logout")}>
          <Button
            type="text"
            shape={compact ? "circle" : undefined}
            icon={<LogoutOutlined />}
            aria-label={t("shell.logout")}
            onClick={onSignOut}
          >
            {compact ? null : t("shell.logout")}
          </Button>
        </Tooltip>
      )}
    </Flex>
  );
}
