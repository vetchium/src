import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MenuProps } from "antd";
import { App, Button, Dropdown, Flex } from "antd";
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

const languages: FrontendLocale[] = ["en-US", "ta", "de_DE"];

export function HeaderControls() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const auth = useAuth();
  const preferences = usePreferences();
  const queryClient = useQueryClient();
  const languageMutation = useMutation({ mutationFn: setPreferredLanguage });

  const selectLanguage: MenuProps["onClick"] = async ({ key }) => {
    if (!isFrontendLocale(key) || key === preferences.language) return;
    try {
      if (auth.authenticated) {
        await languageMutation.mutateAsync({ preferred_language: key });
        queryClient.setQueryData<MyInfoQueryData>(myInfoQueryKey, (current) =>
          current === undefined
            ? current
            : { ...current, preferred_language: key },
        );
      }
      preferences.setLanguage(key);
    } catch {
      void message.error(t("language.changeError"));
    }
  };

  return (
    <Flex gap="small" align="center">
      <Dropdown
        trigger={["click"]}
        menu={{
          selectedKeys: [preferences.language],
          items: languages.map((language) => ({
            key: language,
            label: t(`languages.${language}`),
          })),
          onClick: (info) => void selectLanguage?.(info),
        }}
      >
        <Button
          ghost
          loading={languageMutation.isPending}
          aria-label={t("language.selectorLabel")}
        >
          {t(`languages.${preferences.language}`)}
        </Button>
      </Dropdown>
      <Button
        ghost
        aria-pressed={preferences.themeMode === "dark"}
        aria-label={t("theme.toggleLabel")}
        onClick={preferences.toggleTheme}
      >
        {preferences.themeMode === "dark" ? t("theme.light") : t("theme.dark")}
      </Button>
    </Flex>
  );
}
