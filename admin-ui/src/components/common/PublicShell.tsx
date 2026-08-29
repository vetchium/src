import { PublicShell as SharedPublicShell } from "@vetchium/portal-ui/shell";

export function PublicShell() {
  return (
    <SharedPublicShell
      homePath="/login"
      guardNavigation
      verticallyCentered
      portalTag
    />
  );
}
