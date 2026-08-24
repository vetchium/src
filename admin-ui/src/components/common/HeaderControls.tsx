import {
  GlobalOutlined,
  LogoutOutlined,
  MoonOutlined,
  SunOutlined,
} from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button, Flex, Grid, Select, Switch, Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import {
  type FrontendLocale,
  isFrontendLocale,
} from "../../../../typespec/common/localization.ts";
import { usePreferences } from "../../app/PreferencesContext";
import { useAuth } from "../../auth/AuthContext";
import { setPreferredLanguage } from "../../features/profile/api";
import {
  type MyInfoQueryData,
  myInfoQueryKey,
} from "../../features/profile/queries";

const languages: FrontendLocale[] = ["en-US", "ta", "de-DE"];

interface HeaderControlsProps {
  onSignOut?: () => void;
}

export function HeaderControls({ onSignOut }: HeaderControlsProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const auth = useAuth();
  const preferences = usePreferences();
  const queryClient = useQueryClient();
  const languageMutation = useMutation({ mutationFn: setPreferredLanguage });

  const compact = screens.sm !== true;

  const selectLanguage = async (language: FrontendLocale) => {
    if (!isFrontendLocale(language) || language === preferences.language)
      return;
    try {
      if (auth.authenticated) {
        await languageMutation.mutateAsync({ preferred_language: language });
        queryClient.setQueryData<MyInfoQueryData>(myInfoQueryKey, (current) =>
          current === undefined
            ? current
            : { ...current, preferred_language: language },
        );
      }
      preferences.setLanguage(language);
    } catch {
      void message.error(t("language.changeError"));
    }
  };

  return (
    <Flex gap="small" align="center" wrap={false}>
      <Select<FrontendLocale>
        value={preferences.language}
        aria-label={t("language.selectorLabel")}
        loading={languageMutation.isPending}
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
        onChange={(language) => void selectLanguage(language)}
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
