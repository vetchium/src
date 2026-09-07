import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider, theme } from "antd";
import type { Locale as ComponentLocale } from "antd/es/locale";
import type { i18n } from "i18next";
import type { ComponentType, PropsWithChildren } from "react";
import { useState } from "react";
import type { PortalLocaleConfiguration } from "./localization";
import { PendingOperationProvider } from "./pending-operations";
import { PreferencesProvider, usePreferences } from "./preferences";

function ThemedApplication<Locale extends string>({
  children,
  primaryColor,
  localization,
  componentLocales,
  AuthProvider,
  RecoveryCodesProvider,
}: PropsWithChildren<{
  primaryColor: string;
  localization: PortalLocaleConfiguration<Locale>;
  componentLocales: Record<Locale, ComponentLocale>;
  AuthProvider: ComponentType<PropsWithChildren>;
  RecoveryCodesProvider: ComponentType<PropsWithChildren>;
}>) {
  const { language, themeMode } = usePreferences(localization);
  return (
    <ConfigProvider
      locale={componentLocales[language]}
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

export function PortalProviders<Locale extends string>({
  children,
  i18n,
  primaryColor,
  localization,
  componentLocales,
  AuthProvider,
  RecoveryCodesProvider,
}: PropsWithChildren<{
  i18n: i18n;
  primaryColor: string;
  localization: PortalLocaleConfiguration<Locale>;
  componentLocales: Record<Locale, ComponentLocale>;
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
    <PreferencesProvider i18n={i18n} localization={localization}>
      <QueryClientProvider client={queryClient}>
        <ThemedApplication
          primaryColor={primaryColor}
          localization={localization}
          componentLocales={componentLocales}
          AuthProvider={AuthProvider}
          RecoveryCodesProvider={RecoveryCodesProvider}
        >
          {children}
        </ThemedApplication>
      </QueryClientProvider>
    </PreferencesProvider>
  );
}
