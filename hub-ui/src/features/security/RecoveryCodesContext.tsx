import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { TOTPRecoveryCode } from "../../../../typespec/common/authentication.ts";
import type { HubSessionToken } from "../../../../typespec/hub/auth/types.ts";
import { useHoldNavigation } from "../../app/PendingOperationContext";
import { useAuth } from "../../auth/AuthContext";
import { RecoveryCodesModal } from "./RecoveryCodesModal";

interface RecoveryCodesValue {
  show: (codes: TOTPRecoveryCode[], forSession: HubSessionToken) => void;
}

const RecoveryCodesContext = createContext<RecoveryCodesValue | null>(null);

export function RecoveryCodesProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const [issued, setIssued] = useState<{
    codes: TOTPRecoveryCode[];
    session: HubSessionToken;
  } | null>(null);
  const token = session?.session_token ?? null;
  const codes =
    issued !== null && issued.session === token ? issued.codes : null;

  useEffect(() => {
    if (issued !== null && issued.session !== token) setIssued(null);
  }, [issued, token]);
  useHoldNavigation(codes !== null);

  const value = useMemo<RecoveryCodesValue>(
    () => ({
      show: (shown, forSession) =>
        setIssued({ codes: shown, session: forSession }),
    }),
    [],
  );
  return (
    <RecoveryCodesContext.Provider value={value}>
      {children}
      <RecoveryCodesModal codes={codes} onClose={() => setIssued(null)} />
    </RecoveryCodesContext.Provider>
  );
}

export function useRecoveryCodes(): RecoveryCodesValue {
  const value = useContext(RecoveryCodesContext);
  if (value === null) throw new Error("RecoveryCodesProvider is missing");
  return value;
}
