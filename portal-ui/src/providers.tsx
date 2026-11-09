import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider, theme } from "antd";
import type { Locale as ComponentLocale } from "antd/es/locale";
import type { i18n } from "i18next";
import type { ComponentType, PropsWithChildren } from "react";
import { useState, useSyncExternalStore } from "react";
import type { PortalLocaleConfiguration } from "./localization";
import { PendingOperationProvider } from "./pending-operations";
import { PreferencesProvider, usePreferences } from "./preferences";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia(reducedMotionQuery).matches;
}

function ThemedApplication<Locale extends string>({
  children,
  localization,
  componentLocales,
  AuthProvider,
  RecoveryCodesProvider,
}: PropsWithChildren<{
  localization: PortalLocaleConfiguration<Locale>;
  componentLocales: Record<Locale, ComponentLocale>;
  AuthProvider: ComponentType<PropsWithChildren>;
  RecoveryCodesProvider: ComponentType<PropsWithChildren>;
}>) {
  const { language, themeMode, primaryColor } = usePreferences(localization);
  const reducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    prefersReducedMotion,
  );
  return (
    <ConfigProvider
      locale={componentLocales[language]}
      theme={{
        algorithm:
          themeMode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: primaryColor, motion: !reducedMotion },
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
  primaryColorPresets,
  localization,
  componentLocales,
  AuthProvider,
  RecoveryCodesProvider,
}: PropsWithChildren<{
  i18n: i18n;
  primaryColor: string;
  /**
   * Swatches offered in the header's color picker, which also takes any
   * custom color; omit to offer no choice of color.
   */
  primaryColorPresets?: readonly string[];
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
    <PreferencesProvider
      i18n={i18n}
      localization={localization}
      primaryColor={primaryColor}
      primaryColorPresets={primaryColorPresets}
    >
      <QueryClientProvider client={queryClient}>
        <ThemedApplication
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
