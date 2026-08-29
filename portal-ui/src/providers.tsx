import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider, theme } from "antd";
import deDE from "antd/locale/de_DE";
import enUS from "antd/locale/en_US";
import taIN from "antd/locale/ta_IN";
import type { i18n } from "i18next";
import type { ComponentType, PropsWithChildren } from "react";
import { useState } from "react";
import { PendingOperationProvider } from "./pending-operations";
import { PreferencesProvider, usePreferences } from "./preferences";

function ThemedApplication({
  children,
  primaryColor,
  AuthProvider,
  RecoveryCodesProvider,
}: PropsWithChildren<{
  primaryColor: string;
  AuthProvider: ComponentType<PropsWithChildren>;
  RecoveryCodesProvider: ComponentType<PropsWithChildren>;
}>) {
  const { language, themeMode } = usePreferences();
  const locale = language === "ta" ? taIN : language === "de-DE" ? deDE : enUS;
  return (
    <ConfigProvider
      locale={locale}
      theme={{
        algorithm:
          themeMode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: primaryColor },
      }}
    >
      <AntApp>
        <PendingOperationProvider>
          <AuthProvider>
            <RecoveryCodesProvider>{children}</RecoveryCodesProvider>
          </AuthProvider>
        </PendingOperationProvider>
      </AntApp>
    </ConfigProvider>
  );
}

export function PortalProviders({
  children,
  i18n,
  primaryColor,
  AuthProvider,
  RecoveryCodesProvider,
}: PropsWithChildren<{
  i18n: i18n;
  primaryColor: string;
  AuthProvider: ComponentType<PropsWithChildren>;
  RecoveryCodesProvider: ComponentType<PropsWithChildren>;
}>) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 30_000 },
        },
      }),
  );
  return (
    <PreferencesProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ThemedApplication
          primaryColor={primaryColor}
          AuthProvider={AuthProvider}
          RecoveryCodesProvider={RecoveryCodesProvider}
        >
          {children}
        </ThemedApplication>
      </QueryClientProvider>
    </PreferencesProvider>
  );
}
