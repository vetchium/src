import { PublicShell as SharedPublicShell } from "@vetchium/portal-ui/shell";
import { localeConfiguration } from "../../app/preferences";

export function PublicShell() {
  return <SharedPublicShell localization={localeConfiguration} />;
}
