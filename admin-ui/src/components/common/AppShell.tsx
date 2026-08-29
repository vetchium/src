import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PortalShell } from "@vetchium/portal-ui/shell";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import {
  ViewHubSignupDomains,
  ViewUsers,
} from "typespec/admin/authorization/types";
import type { FrontendLocale } from "typespec/common/localization";
import { usePreferences } from "../../app/PreferencesContext";
import { useAuth } from "../../auth/AuthContext";
import { setPreferredLanguage } from "../../features/profile/api";
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
  const languageMutation = useMutation({ mutationFn: setPreferredLanguage });

  useEffect(() => {
    if (me !== undefined && me.preferred_language !== preferences.language) {
      preferences.setLanguage(me.preferred_language);
    }
  }, [me, preferences]);

  const selectLanguage = async (language: FrontendLocale) => {
    await languageMutation.mutateAsync({ preferred_language: language });
    queryClient.setQueryData<MyInfoQueryData>(myInfoQueryKey, (current) =>
      current === undefined
        ? current
        : { ...current, preferred_language: language },
    );
  };
  const canViewUsers = me?.permissions.includes(ViewUsers) === true;
  const canViewHubSignupDomains =
    me?.permissions.includes(ViewHubSignupDomains) === true;
  const selectedKey = location.pathname.startsWith("/users")
    ? "/users"
    : location.pathname.startsWith("/hub-signup-domains")
      ? "/hub-signup-domains"
      : location.pathname.startsWith("/settings/profile")
        ? "/settings/profile"
        : location.pathname.startsWith("/settings/security")
          ? "/settings/security"
          : "/";
  const navigationItems = [
    { key: "/", label: t("navigation.overview") },
    ...(canViewUsers ? [{ key: "/users", label: t("navigation.users") }] : []),
    ...(canViewHubSignupDomains
      ? [
          {
            key: "/hub-signup-domains",
            label: t("navigation.hubSignupDomains"),
          },
        ]
      : []),
    { key: "/settings/profile", label: t("navigation.profile") },
    { key: "/settings/security", label: t("navigation.security") },
  ];
  return (
    <PortalShell
      navigationItems={navigationItems}
      selectedKey={selectedKey}
      onSignOut={auth.signOut}
      portalTag
      onSelectLanguage={selectLanguage}
      languagePending={languageMutation.isPending}
    />
  );
}
