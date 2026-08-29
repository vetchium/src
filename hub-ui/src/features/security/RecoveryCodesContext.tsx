import {
  RecoveryCodesProvider as SharedRecoveryCodesProvider,
  useRecoveryCodes,
} from "@vetchium/portal-ui/recovery-codes";
import type { PropsWithChildren } from "react";
import { useAuth } from "../../auth/AuthContext";

export { useRecoveryCodes };

export function RecoveryCodesProvider({ children }: PropsWithChildren) {
  const { sessionToken } = useAuth();
  return (
    <SharedRecoveryCodesProvider
      sessionToken={sessionToken}
      translationPrefix="recoveryCodes"
    >
      {children}
    </SharedRecoveryCodesProvider>
  );
}
