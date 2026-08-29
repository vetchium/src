import { PortalProviders } from "@vetchium/portal-ui/providers";
import type { PropsWithChildren } from "react";
import { AuthProvider } from "../auth/AuthContext";
import { RecoveryCodesProvider } from "../features/security/RecoveryCodesContext";
import i18n from "../i18n";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <PortalProviders
      i18n={i18n}
      primaryColor="#2563eb"
      AuthProvider={AuthProvider}
      RecoveryCodesProvider={RecoveryCodesProvider}
    >
      {children}
    </PortalProviders>
  );
}
