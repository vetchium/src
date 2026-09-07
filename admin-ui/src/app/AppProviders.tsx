import { PortalProviders } from "@vetchium/portal-ui/providers";
import deDE from "antd/locale/de_DE";
import enUS from "antd/locale/en_US";
import taIN from "antd/locale/ta_IN";
import type { PropsWithChildren } from "react";
import type { FrontendLocale } from "typespec/admin/types";
import { AuthProvider } from "../auth/AuthContext";
import { RecoveryCodesProvider } from "../features/security/RecoveryCodesContext";
import i18n from "../i18n";
import { localeConfiguration } from "./preferences";

const componentLocales = {
  "en-US": enUS,
  ta: taIN,
  "de-DE": deDE,
} satisfies Record<FrontendLocale, typeof enUS>;

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <PortalProviders
      i18n={i18n}
      primaryColor="#0f766e"
      localization={localeConfiguration}
      componentLocales={componentLocales}
      AuthProvider={AuthProvider}
      RecoveryCodesProvider={RecoveryCodesProvider}
    >
      {children}
    </PortalProviders>
  );
}
