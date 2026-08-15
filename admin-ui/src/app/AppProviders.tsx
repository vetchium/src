import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider, theme } from "antd";
import deDE from "antd/locale/de_DE";
import enUS from "antd/locale/en_US";
import taIN from "antd/locale/ta_IN";
import type { PropsWithChildren } from "react";
import { useState } from "react";
import { AuthProvider } from "../auth/AuthContext";
import { RecoveryCodesProvider } from "../features/security/RecoveryCodesContext";
import { PendingOperationProvider } from "./PendingOperationContext";
import { PreferencesProvider, usePreferences } from "./PreferencesContext";

const primaryColor = "#0f766e";

function ThemedApplication({ children }: PropsWithChildren) {
  const { language, themeMode } = usePreferences();
  const locale = language === "ta" ? taIN : language === "de_DE" ? deDE : enUS;

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

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 30_000,
          },
        },
      }),
  );

  return (
    <PreferencesProvider>
      <QueryClientProvider client={queryClient}>
        <ThemedApplication>{children}</ThemedApplication>
      </QueryClientProvider>
    </PreferencesProvider>
  );
}
