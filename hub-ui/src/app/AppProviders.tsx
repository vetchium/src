import type { PrimaryColorChoice } from "@vetchium/portal-ui/preferences";
import { PortalProviders } from "@vetchium/portal-ui/providers";
import { theme } from "antd";
import deDE from "antd/locale/de_DE";
import enUS from "antd/locale/en_US";
import taIN from "antd/locale/ta_IN";
import type { PropsWithChildren } from "react";
import type { FrontendLocale } from "typespec/hub/types";
import { AuthProvider } from "../auth/AuthContext";
import { RecoveryCodesProvider } from "../features/security/RecoveryCodesContext";
import i18n from "../i18n";
import { localeConfiguration } from "./preferences";

const componentLocales = {
  "en-US": enUS,
  ta: taIN,
  "de-DE": deDE,
} satisfies Record<FrontendLocale, typeof enUS>;

// Ant Design's preset colors that keep white text on a primary button at 3:1
// or better and do not read as an error, warning, or success state.
const primaryColorChoices = (
  ["blue", "geekblue", "purple", "magenta", "volcano"] as const
).map(
  (key): PrimaryColorChoice => ({
    key,
    color: theme.defaultSeed[key],
    labelKey: `theme.primaryColors.${key}`,
  }),
);

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <PortalProviders
      i18n={i18n}
      primaryColor="#2563eb"
      primaryColorChoices={primaryColorChoices}
      localization={localeConfiguration}
      componentLocales={componentLocales}
      AuthProvider={AuthProvider}
      RecoveryCodesProvider={RecoveryCodesProvider}
    >
      {children}
    </PortalProviders>
  );
}
