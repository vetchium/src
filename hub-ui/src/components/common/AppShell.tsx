import { HomeOutlined, SafetyOutlined, UserOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PortalShell } from "@vetchium/portal-ui/shell";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import type { FrontendLocale } from "typespec/common/localization";
import { hubAPI } from "../../api/hub";
import { usePreferences } from "../../app/PreferencesContext";
import { useAuth } from "../../auth/AuthContext";
import {
  type MyInfoQueryData,
  myInfoQueryKey,
  useMyInfoQuery,
} from "../../features/profile/queries";

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
  const selectedKey = location.pathname.startsWith("/settings/profile")
    ? "/settings/profile"
    : location.pathname.startsWith("/settings/security")
      ? "/settings/security"
      : "/";
  const navigationItems = [
    { key: "/", icon: <HomeOutlined />, label: t("navigation.home") },
    {
      key: "/settings/profile",
      icon: <UserOutlined />,
      label: t("navigation.profile"),
    },
    {
      key: "/settings/security",
      icon: <SafetyOutlined />,
      label: t("navigation.security"),
    },
  ];
  return (
    <PortalShell
      navigationItems={navigationItems}
      selectedKey={selectedKey}
      onSignOut={auth.signOut}
      onSelectLanguage={selectLanguage}
      languagePending={languageMutation.isPending}
    />
  );
}
