import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { AdminSessionToken } from "../../../../typespec/admin/auth/types.ts";
import type { TOTPRecoveryCode } from "../../../../typespec/common/authentication.ts";
import { useHoldNavigation } from "../../app/PendingOperationContext";
import { useAuth } from "../../auth/AuthContext";
import { RecoveryCodesModal } from "./RecoveryCodesModal";

interface RecoveryCodesValue {
  /**
   * `forSession` is the session that ISSUED the codes, captured when the
   * request was made. Binding them at arrival instead would attach them to
   * whoever holds the portal by then — nobody, or somebody else.
   */
  show: (codes: TOTPRecoveryCode[], forSession: AdminSessionToken) => void;
}

const RecoveryCodesContext = createContext<RecoveryCodesValue | null>(null);

/**
 * Owns the one and only presentation of a freshly issued set of recovery codes.
 * It lives above the router because the request that produces them can settle
 * after its page has gone: leaving the security page, by menu or by browser
 * history, must not be what destroys the user's only copy.
 */
export function RecoveryCodesProvider({ children }: PropsWithChildren) {
  const { sessionToken } = useAuth();
  const [issued, setIssued] = useState<{
    codes: TOTPRecoveryCode[];
    session: AdminSessionToken;
  } | null>(null);
  // Codes are only ever shown to the session they were issued to. If that
  // session ends or is replaced while they are on screen, they go with it
  // rather than staying visible to whoever signs in next. A signed-out portal
  // has no session, so it can never match one.
  const codes =
    issued !== null && sessionToken !== null && issued.session === sessionToken
      ? issued.codes
      : null;
  useEffect(() => {
    if (issued !== null && issued.session !== sessionToken) {
      setIssued(null);
    }
  }, [issued, sessionToken]);

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
  if (value === null) {
    throw new Error("RecoveryCodesProvider is missing");
  }
  return value;
}
