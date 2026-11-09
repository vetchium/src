import { PortalProviders } from "@vetchium/portal-ui/providers";
import { theme } from "antd";
import deDE from "antd/locale/de_DE";
import enUS from "antd/locale/en_US";
import taIN from "antd/locale/ta_IN";
import type { PropsWithChildren } from "react";
import { AuthProvider } from "../auth/AuthContext";
import { RecoveryCodesProvider } from "../features/security/RecoveryCodesContext";
import i18n from "../i18n";
import { type FrontendLocale, localeConfiguration } from "./preferences";

const componentLocales = {
  "en-US": enUS,
  ta: taIN,
  "de-DE": deDE,
} satisfies Record<FrontendLocale, typeof enUS>;

const primaryColor = "#2563eb";

// The portal's own color, then Ant Design's preset colors that keep white text
// on a primary button at 3:1 or better and do not read as an error, warning,
// or success state.
const primaryColorPresets = [
  primaryColor,
  ...(["blue", "geekblue", "purple", "magenta", "volcano"] as const).map(
    (key) => theme.defaultSeed[key].toLowerCase(),
  ),
];

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <PortalProviders
      i18n={i18n}
      primaryColor={primaryColor}
      primaryColorPresets={primaryColorPresets}
      localization={localeConfiguration}
      componentLocales={componentLocales}
      AuthProvider={AuthProvider}
      RecoveryCodesProvider={RecoveryCodesProvider}
    >
      {children}
    </PortalProviders>
  );
}
