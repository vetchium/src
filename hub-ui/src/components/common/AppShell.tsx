import {
  CreditCardOutlined,
  HomeOutlined,
  MailOutlined,
  SafetyOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PortalShell } from "@vetchium/portal-ui/shell";
import type { ItemType } from "antd/es/menu/interface.js";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import type { FrontendLocale } from "typespec/hub/types";
import { hubAPI } from "../../api/hub";
import { usePreferences } from "../../app/PreferencesContext";
import { localeConfiguration } from "../../app/preferences";
import { useAuth } from "../../auth/AuthContext";
import {
  type MyInfoQueryData,
  myInfoQueryKey,
  useMyInfoQuery,
} from "../../features/profile/queries";
import { SubscriptionEndingAlert } from "../../features/subscriptions/SubscriptionEndingAlert";

const navigationPaths = [
  "/settings/profile",
  "/settings/security",
  "/settings/preferences",
  "/settings/work-emails",
  "/plan",
  "/",
] as const;

export function AppShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const auth = useAuth();
  const preferences = usePreferences();
  const queryClient = useQueryClient();
  const { data: me } = useMyInfoQuery();
  const languageMutation = useMutation({
    mutationFn: (preferred_language: FrontendLocale) =>
      hubAPI.setPreferredLanguage({ preferred_language }),
  });

  useEffect(() => {
    if (me !== undefined && me.preferred_language !== preferences.language) {
      preferences.setLanguage(me.preferred_language);
    }
  }, [me, preferences]);

  const selectLanguage = async (language: FrontendLocale) => {
    await languageMutation.mutateAsync(language);
    auth.updateSession({ preferred_language: language });
    queryClient.setQueryData<MyInfoQueryData>(myInfoQueryKey, (current) =>
      current === undefined
        ? current
        : { ...current, preferred_language: language },
    );
  };
  const selectedKey =
    navigationPaths.find(
      (path) => path !== "/" && location.pathname.startsWith(path),
    ) ?? "/";
  const navigationItems: ItemType[] = [
    { key: "/", icon: <HomeOutlined />, label: t("navigation.home") },
    {
      key: "/settings/profile",
      icon: <UserOutlined />,
      label: t("navigation.profile"),
    },
    {
      key: "/plan",
      icon: <CreditCardOutlined />,
      label: t("navigation.plan"),
    },
    {
      key: "settings",
      type: "group",
      label: t("navigation.settings"),
      children: [
        {
          key: "/settings/security",
          icon: <SafetyOutlined />,
          label: t("navigation.security"),
        },
        {
          key: "/settings/preferences",
          icon: <SettingOutlined />,
          label: t("navigation.preferences"),
        },
        {
          key: "/settings/work-emails",
          icon: <MailOutlined />,
          label: t("navigation.workEmails"),
        },
      ],
    },
  ];
  return (
    <PortalShell
      localization={localeConfiguration}
      navigationItems={navigationItems}
      selectedKey={selectedKey}
      onSignOut={auth.signOut}
      onSelectLanguage={selectLanguage}
      languagePending={languageMutation.isPending}
      banner={<SubscriptionEndingAlert />}
    />
  );
}
