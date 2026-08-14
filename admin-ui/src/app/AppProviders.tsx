import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import type { PropsWithChildren } from "react";
import { useState } from "react";
import { AuthProvider } from "../auth/AuthContext";

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
    <ConfigProvider locale={enUS}>
      <AntApp>
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        </AuthProvider>
      </AntApp>
    </ConfigProvider>
  );
}
