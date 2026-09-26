import { PortalProviders } from "@vetchium/portal-ui/providers";
import deDE from "antd/locale/de_DE";
import enUS from "antd/locale/en_US";
import taIN from "antd/locale/ta_IN";
import type { PropsWithChildren } from "react";
import i18n from "../i18n";
import { type FrontendLocale, localeConfiguration } from "./preferences";

const componentLocales = {
  "en-US": enUS,
  ta: taIN,
  "de-DE": deDE,
} satisfies Record<FrontendLocale, typeof enUS>;

// PortalProviders reserves these two slots for a portal's sign-in adapters.
// Orgs sign-in is not built yet, so both pass their children through.
function NoAdapter({ children }: PropsWithChildren) {
  return children;
}

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <PortalProviders
      i18n={i18n}
      primaryColor="#2563eb"
      localization={localeConfiguration}
      componentLocales={componentLocales}
      AuthProvider={NoAdapter}
      RecoveryCodesProvider={NoAdapter}
    >
      {children}
    </PortalProviders>
  );
}
